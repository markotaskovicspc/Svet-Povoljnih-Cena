import "server-only";

import { createHash } from "node:crypto";
import {
  Prisma,
  type FiscalDocument,
  type FiscalDocumentLine,
  type FiscalDocumentSource,
  type Order,
  type OrderItem,
  type PaymentMethod,
} from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import { ipsPaymentProvider } from "@/lib/payments";
import { providerForPaymentMethod } from "@/lib/payments/types";
import { fiscalize, type FiscalDispatchResult } from "./transport";

export type FiscalIssueOutcome =
  | {
      ok: true;
      created: boolean;
      receipt: { id: string; receiptNumber: string; qrUrl: string | null; fiscalizedAt: Date };
      order: OrderWithItems;
    }
  | { ok: false; error: string; reason: "not_found" | "already_issued" | "gateway_failure" };

export type FiscalRefundOutcome =
  | {
      ok: true;
      documents: { id: string; receiptNumber: string; qrUrl: string | null; issuedAt: Date }[];
      refundedGross: number;
      paymentErrors: string[];
    }
  | { ok: false; error: string; reason: "not_found" | "already_refunded" | "gateway_failure" | "invalid_request" };

type OrderWithItems = Order & { items: OrderItem[] };

const VAT_RATE = 20;
const VAT_FACTOR = 1 + VAT_RATE / 100;

const PAYMENT_METHOD_GATEWAY: Record<PaymentMethod, "CASH" | "CARD" | "TRANSFER" | "OTHER"> = {
  POUZECE_GOTOVINA: "CASH",
  POUZECE_KARTICA: "CARD",
  KARTICA: "CARD",
  GOOGLE_PAY: "CARD",
  APPLE_PAY: "CARD",
  IPS: "TRANSFER",
  UPLATA_NA_RACUN: "TRANSFER",
};

type FiscalOrder = NonNullable<Awaited<ReturnType<typeof loadOrderForFiscal>>>;
type FiscalOrderItem = FiscalOrder["items"][number];

type SaleLineDraft = {
  item: FiscalOrderItem;
  qty: number;
  unitPriceGross: number;
  totalGross: number;
  totalNet: number;
  totalVat: number;
};

type PersistedFiscalDocument = FiscalDocument & { lines: FiscalDocumentLine[] };

export async function issueFiscalSale(input: {
  orderId: string;
  orderItemIds?: string[];
  paymentMethod?: PaymentMethod;
  source?: Exclude<FiscalDocumentSource, "REFUND">;
}): Promise<FiscalIssueOutcome> {
  const order = await loadOrderForFiscal(input.orderId);
  if (!order) {
    return { ok: false, reason: "not_found", error: `Porudžbina ${input.orderId} ne postoji.` };
  }

  const selectedIds = input.orderItemIds?.length ? new Set(input.orderItemIds) : null;
  const candidates = order.items.filter((item) => !selectedIds || selectedIds.has(item.id));
  if (!candidates.length) {
    return { ok: false, reason: "not_found", error: "Nema izabranih stavki za fiskalizaciju." };
  }

  const existingQty = await getIssuedSaleQuantities(candidates.map((item) => item.id));
  const drafts = candidates
    .map((item) => {
      const remaining = item.qty - (existingQty.get(item.id) ?? 0);
      return remaining > 0 ? buildSaleLineDraft(item, remaining) : null;
    })
    .filter((item): item is SaleLineDraft => Boolean(item));

  if (!drafts.length) {
    const existing = await db.fiscalDocument.findFirst({
      where: { orderId: order.id, kind: "SALE", status: "ISSUED" },
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      include: { lines: true },
    });
    if (existing?.receiptNumber && existing.issuedAt) {
      return saleOutcome(existing, order, false);
    }
    return { ok: false, reason: "already_issued", error: "Sve izabrane stavke su već fiskalizovane." };
  }

  const paymentMethod = input.paymentMethod ?? order.paymentMethod;
  const source = input.source ?? "MANUAL";
  const idempotencyKey = buildIdempotencyKey(
    "sale",
    order.number,
    source,
    paymentMethod,
    drafts.map((line) => `${line.item.id}:${line.qty}`).sort().join("|"),
  );
  const warehouse = await ensureDefaultWarehouse();

  const existingDocument = await db.fiscalDocument.findUnique({
    where: { idempotencyKey },
    include: { lines: true },
  });
  if (existingDocument?.status === "ISSUED" && existingDocument.receiptNumber && existingDocument.issuedAt) {
    return saleOutcome(existingDocument, order, false);
  }

  const totals = sumDrafts(drafts);
  const rawRequest = buildFiscalRequestPreview({
    idempotencyKey,
    order,
    paymentMethod,
    transactionType: "SALE",
    totalGross: totals.totalGross,
    lines: drafts.map((line) => ({
      sku: line.item.sku,
      name: line.item.name,
      qty: line.qty,
      unitPrice: line.unitPriceGross,
    })),
  });

  const document = existingDocument ?? (await db.fiscalDocument.create({
    data: {
      orderId: order.id,
      kind: "SALE",
      status: "PENDING",
      source,
      paymentMethod,
      idempotencyKey,
      totalGross: decimal(totals.totalGross),
      totalNet: decimal(totals.totalNet),
      totalVat: decimal(totals.totalVat),
      rawRequest: rawRequest as Prisma.InputJsonValue,
      lines: {
        create: drafts.map((line) => saleLineCreate(line, order, warehouse.name)),
      },
    },
    include: { lines: true },
  }));

  const dispatch = await fiscalize({
    invoiceRef: idempotencyKey,
    idempotencyKey,
    transactionType: "SALE",
    total: totals.totalGross,
    paymentMethod: PAYMENT_METHOD_GATEWAY[paymentMethod],
    buyer: buyerForFiscal(order),
    lines: document.lines.map((line) => ({
      sku: line.sku,
      name: line.shortName,
      qty: line.qty,
      unitPrice: num(line.unitPriceGross),
    })),
  });

  if (!dispatch.ok) {
    await markDocumentFailed(document.id, dispatch);
    return { ok: false, reason: "gateway_failure", error: dispatch.error };
  }

  const issuedAt = new Date(dispatch.receipt.fiscalizedAt);
  const issued = await db.fiscalDocument.update({
    where: { id: document.id },
    data: {
      status: "ISSUED",
      receiptNumber: dispatch.receipt.receiptNumber,
      qrUrl: dispatch.receipt.qrUrl,
      rawResponse: dispatch.receipt.raw as Prisma.InputJsonValue,
      error: null,
      issuedAt,
    },
    include: { lines: true },
  });

  return saleOutcome(issued, order, !existingDocument);
}

export async function issueFiscalRefund(input: {
  fiscalLineIds: string[];
  paymentReturnMethod: PaymentMethod;
  warehouseId: string;
  actorId?: string | null;
}): Promise<FiscalRefundOutcome> {
  const uniqueLineIds = Array.from(new Set(input.fiscalLineIds.filter(Boolean)));
  if (!uniqueLineIds.length) {
    return { ok: false, reason: "invalid_request", error: "Izaberite bar jedan fiskalni red." };
  }

  const warehouse = await db.warehouse.findFirst({
    where: { id: input.warehouseId, active: true },
    select: { id: true, name: true },
  });
  if (!warehouse) {
    return { ok: false, reason: "invalid_request", error: "Izabrani magacin nije aktivan." };
  }

  const saleLines = await db.fiscalDocumentLine.findMany({
    where: {
      id: { in: uniqueLineIds },
      fiscalDocument: { is: { kind: "SALE", status: "ISSUED" } },
    },
    include: {
      fiscalDocument: { include: { order: { select: { id: true, number: true } } } },
      orderItem: { select: { productId: true, sku: true } },
    },
  });

  const refundable = saleLines
    .map((line) => ({ line, qty: line.qty - line.refundedQty }))
    .filter((item) => item.qty > 0);

  if (!refundable.length) {
    return { ok: false, reason: "already_refunded", error: "Izabrani redovi su već refundirani." };
  }

  const groups = groupBy(refundable, (item) => item.line.fiscalDocumentId);
  const documents: { id: string; receiptNumber: string; qrUrl: string | null; issuedAt: Date }[] = [];
  const paymentErrors: string[] = [];
  let refundedGross = 0;

  for (const group of groups.values()) {
    const first = group[0]!.line;
    const originalReceiptNumber = first.fiscalDocument.receiptNumber;
    if (!originalReceiptNumber) {
      return { ok: false, reason: "invalid_request", error: "Originalni fiskalni račun nema broj računa." };
    }

    const totals = sumRefundLines(group);
    const order = first.fiscalDocument.order;
    const idempotencyKey = buildIdempotencyKey(
      "refund",
      order.number,
      originalReceiptNumber,
      input.paymentReturnMethod,
      warehouse.id,
      group.map((item) => `${item.line.id}:${item.qty}`).sort().join("|"),
    );

    const existing = await db.fiscalDocument.findUnique({
      where: { idempotencyKey },
      include: { lines: true },
    });
    if (existing?.status === "ISSUED" && existing.receiptNumber && existing.issuedAt) {
      documents.push({
        id: existing.id,
        receiptNumber: existing.receiptNumber,
        qrUrl: existing.qrUrl,
        issuedAt: existing.issuedAt,
      });
      continue;
    }

    const rawRequest = buildFiscalRequestPreview({
      idempotencyKey,
      transactionType: "REFUND",
      originalReceiptNumber,
      paymentMethod: input.paymentReturnMethod,
      totalGross: totals.totalGross,
      lines: group.map((item) => ({
        sku: item.line.sku,
        name: item.line.shortName,
        qty: item.qty,
        unitPrice: num(item.line.unitPriceGross),
      })),
    });

    const document = existing ?? (await db.fiscalDocument.create({
      data: {
        orderId: order.id,
        kind: "REFUND",
        status: "PENDING",
        source: "REFUND",
        paymentMethod: input.paymentReturnMethod,
        warehouseId: warehouse.id,
        idempotencyKey,
        totalGross: decimal(totals.totalGross),
        totalNet: decimal(totals.totalNet),
        totalVat: decimal(totals.totalVat),
        rawRequest: rawRequest as Prisma.InputJsonValue,
        lines: {
          create: group.map((item) => refundLineCreate(item.line, item.qty, warehouse.name)),
        },
      },
      include: { lines: true },
    }));

    const dispatch = await fiscalize({
      invoiceRef: idempotencyKey,
      idempotencyKey,
      transactionType: "REFUND",
      invoiceType: "REFUND",
      originalReceiptNumber,
      total: totals.totalGross,
      paymentMethod: PAYMENT_METHOD_GATEWAY[input.paymentReturnMethod],
      lines: document.lines.map((line) => ({
        sku: line.sku,
        name: line.shortName,
        qty: line.qty,
        unitPrice: num(line.unitPriceGross),
      })),
    });

    if (!dispatch.ok) {
      await markDocumentFailed(document.id, dispatch);
      return { ok: false, reason: "gateway_failure", error: dispatch.error };
    }

    const issuedAt = new Date(dispatch.receipt.fiscalizedAt);
    await db.$transaction(async (tx) => {
      await tx.fiscalDocument.update({
        where: { id: document.id },
        data: {
          status: "ISSUED",
          receiptNumber: dispatch.receipt.receiptNumber,
          qrUrl: dispatch.receipt.qrUrl,
          rawResponse: dispatch.receipt.raw as Prisma.InputJsonValue,
          error: null,
          issuedAt,
        },
      });

      for (const item of group) {
        const line = item.line;
        const updated = await tx.fiscalDocumentLine.updateMany({
          where: { id: line.id, refundedQty: { lte: line.qty - item.qty } },
          data: { refundedQty: { increment: item.qty } },
        });
        if (updated.count !== 1) {
          throw new Error(`Fiskalni red ${line.id} je već refundiran.`);
        }

        if (line.productId) {
          await tx.product.update({
            where: { id: line.productId },
            data: { stock: { increment: item.qty }, isActive: true },
          });
          await tx.warehouseStock.upsert({
            where: { warehouseId_productId: { warehouseId: warehouse.id, productId: line.productId } },
            create: { warehouseId: warehouse.id, productId: line.productId, qty: item.qty },
            update: { qty: { increment: item.qty } },
          });
        }

        await tx.stockMovement.create({
          data: {
            warehouseId: warehouse.id,
            productId: line.productId,
            orderId: order.id,
            orderItemId: line.orderItemId,
            fiscalDocumentId: document.id,
            kind: "REFUND_RETURN",
            sku: line.sku,
            qty: item.qty,
            actorId: input.actorId ?? null,
            note: `Refundacija fiskalnog računa ${originalReceiptNumber}`,
          },
        });
      }
    });

    const paymentError = await recordPaymentRefund({
      orderId: order.id,
      orderNumber: order.number,
      fiscalDocumentId: document.id,
      method: input.paymentReturnMethod,
      amount: totals.totalGross,
      actorId: input.actorId ?? null,
    });
    if (paymentError) paymentErrors.push(paymentError);

    refundedGross += totals.totalGross;
    documents.push({
      id: document.id,
      receiptNumber: dispatch.receipt.receiptNumber,
      qrUrl: dispatch.receipt.qrUrl,
      issuedAt,
    });
  }

  return { ok: true, documents, refundedGross: money(refundedGross), paymentErrors };
}

export async function issueFiscalReceiptForOrder(orderId: string): Promise<FiscalIssueOutcome> {
  return issueFiscalSale({ orderId, source: "MANUAL" });
}

export async function tryIssueFiscalReceipt(orderId: string): Promise<FiscalIssueOutcome> {
  try {
    const outcome = await issueFiscalSale({ orderId, source: "AUTO_PICKUP" });
    if (!outcome.ok) {
      console.error(`[fiscal] issue failed for ${orderId}: ${outcome.error}`);
    }
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[fiscal] issue threw for ${orderId}: ${message}`);
    return { ok: false, reason: "gateway_failure", error: message };
  }
}

export async function isOrderFullyFiscalized(orderId: string): Promise<boolean> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { items: { select: { id: true, qty: true } } },
  });
  if (!order) return false;
  if (!order.items.length) return true;
  const issued = await getIssuedSaleQuantities(order.items.map((item) => item.id));
  return order.items.every((item) => (issued.get(item.id) ?? 0) >= item.qty);
}

export async function getIssuedSaleDocumentsForOrder(orderId: string) {
  return db.fiscalDocument.findMany({
    where: { orderId, kind: "SALE", status: "ISSUED" },
    orderBy: [{ issuedAt: "asc" }, { createdAt: "asc" }],
    include: { lines: true },
  });
}

export async function ensureDefaultWarehouse() {
  return db.warehouse.upsert({
    where: { code: "DC" },
    create: { code: "DC", name: "DC", isDefault: true },
    update: { active: true, isDefault: true },
  });
}

export function paymentMethodLabel(method: PaymentMethod): string {
  switch (method) {
    case "POUZECE_GOTOVINA":
      return "Pouzećem (gotovina)";
    case "POUZECE_KARTICA":
      return "Pouzećem (kartica)";
    case "KARTICA":
      return "Platna kartica";
    case "GOOGLE_PAY":
      return "Google Pay";
    case "APPLE_PAY":
      return "Apple Pay";
    case "IPS":
      return "IPS QR";
    case "UPLATA_NA_RACUN":
      return "Uplata na račun";
  }
}

async function loadOrderForFiscal(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { email: true } },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              shortDescription: true,
              sizeLabel: true,
              colorPrimary: true,
              colorSecondary: true,
              supplier: { select: { name: true } },
              group: { select: { name: true } },
              collection: { select: { name: true } },
              categories: {
                take: 1,
                select: { category: { select: { name: true, path: true } } },
              },
            },
          },
        },
      },
    },
  });
}

async function getIssuedSaleQuantities(orderItemIds: string[]) {
  if (!orderItemIds.length) return new Map<string, number>();
  const lines = await db.fiscalDocumentLine.findMany({
    where: {
      orderItemId: { in: orderItemIds },
      fiscalDocument: { is: { kind: "SALE", status: "ISSUED" } },
    },
    select: { orderItemId: true, qty: true },
  });
  const byItem = new Map<string, number>();
  for (const line of lines) byItem.set(line.orderItemId, (byItem.get(line.orderItemId) ?? 0) + line.qty);
  return byItem;
}

function buildSaleLineDraft(item: FiscalOrderItem, qty: number): SaleLineDraft {
  const unitPriceGross = money(num(item.unitPriceSale) + (item.withAssembly && item.assemblyPrice ? num(item.assemblyPrice) : 0));
  const totalGross = money(unitPriceGross * qty);
  const totalNet = money(totalGross / VAT_FACTOR);
  return {
    item,
    qty,
    unitPriceGross,
    totalGross,
    totalNet,
    totalVat: money(totalGross - totalNet),
  };
}

function saleLineCreate(line: SaleLineDraft, order: FiscalOrder, warehouseName: string) {
  const product = line.item.product;
  const category = product?.categories[0]?.category ?? null;
  const companyName = order.billCompanyName ?? order.shipCompanyName ?? null;
  const firstName = order.billFirstName ?? order.shipFirstName;
  const lastName = order.billLastName ?? order.shipLastName;
  const street = order.billStreet ?? order.shipStreet;
  const city = order.billCity ?? order.shipCity;
  const postalCode = order.billPostalCode ?? order.shipPostalCode;
  return {
    orderItemId: line.item.id,
    productId: line.item.productId,
    priceList: "MP",
    orderNumber: order.number,
    customerName: companyName ?? `${firstName} ${lastName}`,
    companyName,
    pib: order.billPib ?? order.shipPib ?? null,
    address: street,
    city,
    postalCode,
    phone: order.shipPhone,
    email: order.guestEmail ?? order.user?.email ?? null,
    sku: line.item.sku,
    supplierName: line.item.supplierName ?? product?.supplier?.name ?? null,
    categoryName: line.item.categoryName ?? category?.name ?? null,
    categoryPath: line.item.categoryPath ?? category?.path ?? null,
    groupName: line.item.groupName ?? product?.group?.name ?? null,
    subgroupName: line.item.subgroupName ?? line.item.categoryPath ?? category?.path ?? null,
    collectionName: line.item.collectionName ?? product?.collection?.name ?? null,
    shortDescription: line.item.shortDescriptionSnapshot ?? product?.shortDescription ?? null,
    shortName: line.item.shortNameSnapshot ?? line.item.name,
    attribute1: line.item.attribute1 ?? product?.sizeLabel ?? null,
    attribute2: line.item.attribute2 ?? product?.colorPrimary ?? null,
    attribute3: line.item.attribute3 ?? product?.colorSecondary ?? null,
    attribute4: line.item.attribute4 ?? null,
    color1: line.item.color1 ?? product?.colorPrimary ?? null,
    color2: line.item.color2 ?? product?.colorSecondary ?? null,
    warehouseName,
    qty: line.qty,
    vatRate: decimal(VAT_RATE),
    unitPriceGross: decimal(line.unitPriceGross),
    totalGross: decimal(line.totalGross),
    totalNet: decimal(line.totalNet),
    totalVat: decimal(line.totalVat),
  };
}

function refundLineCreate(line: FiscalDocumentLine, qty: number, warehouseName: string) {
  const unitPriceGross = num(line.unitPriceGross);
  const totalGross = money(unitPriceGross * qty);
  const totalNet = money(totalGross / VAT_FACTOR);
  return {
    orderItemId: line.orderItemId,
    productId: line.productId,
    originalSaleLineId: line.id,
    priceList: line.priceList,
    orderNumber: line.orderNumber,
    customerName: line.customerName,
    companyName: line.companyName,
    pib: line.pib,
    address: line.address,
    city: line.city,
    postalCode: line.postalCode,
    phone: line.phone,
    email: line.email,
    sku: line.sku,
    supplierName: line.supplierName,
    categoryName: line.categoryName,
    categoryPath: line.categoryPath,
    groupName: line.groupName,
    subgroupName: line.subgroupName,
    collectionName: line.collectionName,
    shortDescription: line.shortDescription,
    shortName: line.shortName,
    attribute1: line.attribute1,
    attribute2: line.attribute2,
    attribute3: line.attribute3,
    attribute4: line.attribute4,
    color1: line.color1,
    color2: line.color2,
    warehouseName,
    qty,
    vatRate: line.vatRate,
    unitPriceGross: line.unitPriceGross,
    totalGross: decimal(totalGross),
    totalNet: decimal(totalNet),
    totalVat: decimal(totalGross - totalNet),
  };
}

function saleOutcome(document: PersistedFiscalDocument, order: FiscalOrder, created: boolean): FiscalIssueOutcome {
  return {
    ok: true,
    created,
    receipt: {
      id: document.id,
      receiptNumber: document.receiptNumber ?? document.id,
      qrUrl: document.qrUrl,
      fiscalizedAt: document.issuedAt ?? document.createdAt,
    },
    order: order as unknown as OrderWithItems,
  };
}

function sumDrafts(lines: SaleLineDraft[]) {
  return lines.reduce(
    (acc, line) => ({
      totalGross: money(acc.totalGross + line.totalGross),
      totalNet: money(acc.totalNet + line.totalNet),
      totalVat: money(acc.totalVat + line.totalVat),
    }),
    { totalGross: 0, totalNet: 0, totalVat: 0 },
  );
}

function sumRefundLines(lines: { line: FiscalDocumentLine; qty: number }[]) {
  return lines.reduce(
    (acc, item) => {
      const totalGross = money(num(item.line.unitPriceGross) * item.qty);
      const totalNet = money(totalGross / VAT_FACTOR);
      return {
        totalGross: money(acc.totalGross + totalGross),
        totalNet: money(acc.totalNet + totalNet),
        totalVat: money(acc.totalVat + totalGross - totalNet),
      };
    },
    { totalGross: 0, totalNet: 0, totalVat: 0 },
  );
}

function buyerForFiscal(order: FiscalOrder) {
  const tin = order.billPib ?? order.shipPib;
  if (!tin) return undefined;
  return {
    tin,
    name: order.billCompanyName ?? order.shipCompanyName ?? `${order.shipFirstName} ${order.shipLastName}`,
  };
}

function buildFiscalRequestPreview(args: {
  idempotencyKey: string;
  order?: FiscalOrder;
  paymentMethod: PaymentMethod;
  transactionType: "SALE" | "REFUND";
  originalReceiptNumber?: string;
  totalGross: number;
  lines: { sku: string; name: string; qty: number; unitPrice: number }[];
}) {
  return {
    reference: args.idempotencyKey,
    transactionType: args.transactionType,
    originalReceiptNumber: args.originalReceiptNumber ?? null,
    paymentMethod: PAYMENT_METHOD_GATEWAY[args.paymentMethod],
    buyer: args.order ? buyerForFiscal(args.order) ?? null : null,
    total: args.totalGross,
    items: args.lines,
  };
}

async function markDocumentFailed(documentId: string, dispatch: Extract<FiscalDispatchResult, { ok: false }>) {
  await db.fiscalDocument.update({
    where: { id: documentId },
    data: { status: "FAILED", error: dispatch.error },
  });
}

async function recordPaymentRefund(args: {
  orderId: string;
  orderNumber: string;
  fiscalDocumentId: string;
  method: PaymentMethod;
  amount: number;
  actorId: string | null;
}): Promise<string | null> {
  const provider = providerForPaymentMethod(args.method);
  let status: "COMPLETED" | "FAILED" = "COMPLETED";
  let rawRequest: Prisma.InputJsonValue | undefined;
  let rawResponse: Prisma.InputJsonValue | undefined;
  let providerRef: string | null = null;
  let error: string | null = null;

  if (args.method === "IPS") {
    try {
      const result = await ipsPaymentProvider.refundPayment(args.orderNumber, args.amount);
      rawRequest = result.rawRequest as Prisma.InputJsonValue;
      rawResponse = result.rawResponse as Prisma.InputJsonValue;
      providerRef = result.responseCode;
      if (!result.refunded) {
        status = "FAILED";
        error = `IPS nije potvrdio povraćaj (kod ${result.responseCode || "-"}).`;
      }
    } catch (err) {
      status = "FAILED";
      error = err instanceof Error ? err.message : String(err);
    }
  }

  await db.paymentRefund.create({
    data: {
      orderId: args.orderId,
      fiscalDocumentId: args.fiscalDocumentId,
      method: args.method,
      provider,
      status,
      amount: decimal(args.amount),
      providerRef,
      rawRequest,
      rawResponse,
      error,
      actorId: args.actorId,
      completedAt: status === "COMPLETED" ? new Date() : null,
    },
  });

  return error;
}

function buildIdempotencyKey(...parts: string[]) {
  const raw = parts.join(":");
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 24);
  return `${parts[0]}:${parts[1]}:${hash}`;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function decimal(value: number) {
  return new Prisma.Decimal(money(value).toFixed(2));
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
