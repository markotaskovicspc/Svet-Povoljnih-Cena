import "server-only";

import { randomUUID } from "node:crypto";
import {
  PaymentProvider,
  PaymentStatus,
  Prisma,
  SalesChannel,
  StockMovementKind,
  type OrderStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { adjustInventory } from "@/lib/inventory";
import { syncProductChannelAvailability } from "@/lib/channel-availability.server";
import { resolveRabaluxAvailability } from "@/lib/rabalux/availability";
import { isRabaluxSupplierOperational } from "@/lib/rabalux/config";
import {
  SUPPLIER_ALLOCATION,
  calculateSalesLineTotals,
  manualOrderNumberPrefix,
  manualSalesOrderInputSchema,
  resolveSalesOrderWarehouse,
  type ManualSalesOrderInput,
} from "@/lib/admin/sales-order";

const MANUAL_CHANNELS: SalesChannel[] = [SalesChannel.VP, SalesChannel.INO];
const EDITABLE_STATUSES: OrderStatus[] = [
  "KREIRANO",
  "POTVRDJENO",
  "U_PRIPREMI",
  "SPREMNO_ZA_ISPORUKU",
];

const productInclude = {
  supplier: {
    select: {
      id: true,
      name: true,
      integrationKey: true,
      enabled: true,
    },
  },
  group: { select: { name: true } },
  collection: { select: { name: true } },
  categories: {
    orderBy: { category: { level: "desc" as const } },
    include: {
      category: {
        select: {
          name: true,
          path: true,
          level: true,
          parent: { select: { name: true } },
        },
      },
    },
  },
  warehouseStocks: {
    where: { warehouse: { active: true } },
    include: {
      warehouse: {
        select: { id: true, code: true, name: true, isDefault: true },
      },
    },
  },
} satisfies Prisma.ProductInclude;

type LoadedProduct = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export type SalesOrderCustomerOption = {
  id: string;
  label: string;
  firstName: string;
  lastName: string;
  companyName: string;
  pib: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
};

export type SalesOrderPriceListOption = {
  id: string;
  code: string;
  name: string;
  kind: string;
  currency: string;
};

export type SalesOrderWarehouseOption = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
};

export type SalesOrderFormOptions = {
  customers: SalesOrderCustomerOption[];
  priceLists: SalesOrderPriceListOption[];
  warehouses: SalesOrderWarehouseOption[];
};

export type SalesOrderProductData = {
  productId: string;
  sku: string;
  articleStatus: string;
  supplier: string;
  supplierId: string | null;
  category: string;
  group: string;
  subgroup: string;
  collection: string;
  shortDescription: string;
  shortName: string;
  attribute1: string;
  attribute2: string;
  attribute3: string;
  attribute4: string;
  color1: string;
  color2: string;
  unitPrice: number | null;
  priceSource: string;
  defaultAllocation: string;
  supplierAllocationAllowed: boolean;
  warehouseAvailability: Record<string, number>;
};

export type SalesOrderFormLine = SalesOrderProductData & {
  id?: string;
  qty: number;
  allocation: string;
};

export type SalesOrderDetail = {
  id: string;
  number: string;
  channel: string;
  status: string;
  customerId: string;
  priceListId: string;
  currency: string;
  paid: boolean;
  sefAccepted: boolean;
  fiscalized: boolean;
  invoiced: boolean;
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
  customerSnapshot: Omit<SalesOrderCustomerOption, "id">;
  lines: SalesOrderFormLine[];
};

function numberValue(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : value.toNumber();
}

function productNames(product: LoadedProduct) {
  const leaf = product.categories[0]?.category ?? null;
  return {
    supplier: product.supplier?.name ?? "",
    category: leaf?.parent?.name ?? leaf?.name ?? "",
    group: product.group?.name ?? "",
    subgroup: leaf?.parent ? leaf.name : "",
    collection: product.collection?.name ?? "",
    shortDescription: product.shortDescription ?? "",
    shortName: product.shortName ?? product.name,
    attribute1: product.attribute1 ?? "",
    attribute2: product.attribute2 ?? "",
    attribute3: product.attribute3 ?? "",
    attribute4: product.attribute4 ?? "",
    color1: product.colorPrimary ?? "",
    color2: product.colorSecondary ?? "",
  };
}

function customerLabel(customer: {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
}) {
  return (
    customer.companyName?.trim() ||
    [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
    "Kupac bez naziva"
  );
}

function toCustomerOption(customer: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  pib: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
}): SalesOrderCustomerOption {
  return {
    id: customer.id,
    label: customerLabel(customer),
    firstName: customer.firstName ?? "",
    lastName: customer.lastName ?? "",
    companyName: customer.companyName ?? "",
    pib: customer.pib ?? "",
    address: customer.address ?? "",
    city: customer.city ?? "",
    postalCode: customer.postalCode ?? "",
    country: customer.country,
    phone: customer.phone ?? "",
    email: customer.email ?? "",
  };
}

function customerSnapshotFromOrder(order: {
  shipFirstName: string;
  shipLastName: string;
  shipCompanyName: string | null;
  shipPib: string | null;
  shipStreet: string;
  shipCity: string;
  shipPostalCode: string;
  shipCountry: string;
  shipPhone: string;
  guestEmail: string | null;
}) {
  return {
    label:
      order.shipCompanyName ||
      [order.shipFirstName, order.shipLastName].filter(Boolean).join(" "),
    firstName: order.shipFirstName,
    lastName: order.shipLastName,
    companyName: order.shipCompanyName ?? "",
    pib: order.shipPib ?? "",
    address: order.shipStreet,
    city: order.shipCity,
    postalCode: order.shipPostalCode,
    country: order.shipCountry,
    phone: order.shipPhone,
    email: order.guestEmail ?? "",
  };
}

export async function getSalesOrderFormOptions(): Promise<SalesOrderFormOptions> {
  const now = new Date();
  const customers = await db.customer.findMany({
    take: 2_000,
    orderBy: [{ companyName: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
  });
  const priceLists = await db.priceList.findMany({
    where: {
      active: true,
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gte: now } }] },
      ],
    },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  const warehouses = await db.warehouse.findMany({
    where: { active: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return {
    customers: customers.map(toCustomerOption),
    priceLists: priceLists.map((priceList) => ({
      id: priceList.id,
      code: priceList.code,
      name: priceList.name,
      kind: priceList.kind,
      currency: priceList.currency,
    })),
    warehouses: warehouses.map((warehouse) => ({
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name,
      isDefault: warehouse.isDefault,
    })),
  };
}

async function productData(
  product: LoadedProduct,
  priceListId: string,
  unitPriceOverride?: number | null,
): Promise<SalesOrderProductData> {
  const now = new Date();
  const priceEntry =
    unitPriceOverride === undefined
      ? await db.priceListEntry.findFirst({
          where: {
            priceListId,
            productId: product.id,
            validFrom: { lte: now },
            OR: [{ validTo: null }, { validTo: { gte: now } }],
          },
          orderBy: { validFrom: "desc" },
          select: { price: true },
        })
      : null;
  const defaultWarehouse =
    product.warehouseStocks.find((row) => row.warehouse.isDefault)?.warehouse ??
    (await db.warehouse.findFirst({
      where: { active: true, isDefault: true },
      select: { id: true, code: true, name: true, isDefault: true },
    }));
  const defaultStock = defaultWarehouse
    ? product.warehouseStocks.find(
        (row) => row.warehouseId === defaultWarehouse.id,
      )?.qty ?? product.stock
    : product.stock;
  const suggestion = resolveSalesOrderWarehouse({
    articleStatus: product.articleStatus,
    dcAvailableQty: defaultStock,
    defaultWarehouseId: defaultWarehouse?.id ?? null,
  });
  const suggestedAllocation =
    suggestion?.type === "SUPPLIER"
      ? SUPPLIER_ALLOCATION
      : suggestion?.type === "WAREHOUSE"
        ? suggestion.warehouseId
        : "";
  return {
    productId: product.id,
    sku: product.sku,
    articleStatus: product.articleStatus,
    supplierId: product.supplierId,
    ...productNames(product),
    unitPrice:
      unitPriceOverride !== undefined
        ? unitPriceOverride
        : numberValue(priceEntry?.price),
    priceSource:
      unitPriceOverride !== undefined
        ? "Sačuvana cena porudžbine"
        : priceEntry
          ? "Važeća stavka cenovnika"
          : "Nema važeće stavke u izabranom cenovniku",
    defaultAllocation: suggestedAllocation,
    supplierAllocationAllowed:
      product.articleStatus === "DOB" && Boolean(product.supplierId),
    warehouseAvailability: {
      ...Object.fromEntries(
        product.warehouseStocks.map((row) => [row.warehouseId, row.qty]),
      ),
      ...(defaultWarehouse ? { [defaultWarehouse.id]: defaultStock } : {}),
    },
  };
}

export async function getSalesOrderProduct(
  sku: string,
  priceListId: string,
): Promise<SalesOrderProductData> {
  const normalizedSku = sku.trim();
  if (!normalizedSku) throw new Error("Unesite šifru artikla.");
  if (!priceListId) throw new Error("Prvo izaberite cenovnik.");
  const priceList = await db.priceList.findFirst({
    where: { id: priceListId, active: true },
    select: { id: true },
  });
  const product = await db.product.findUnique({
    where: { sku: normalizedSku },
    include: productInclude,
  });
  if (!priceList) throw new Error("Izabrani cenovnik nije aktivan.");
  if (!product || product.deletedAt) {
    throw new Error(`Artikal sa šifrom ${normalizedSku} ne postoji.`);
  }
  return productData(product, priceListId);
}

function parseInput(input: unknown) {
  const parsed = manualSalesOrderInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues.map((issue) => issue.message).join(" "),
    );
  }
  return parsed.data;
}

async function loadCustomerAndPriceList(
  tx: Prisma.TransactionClient,
  input: ManualSalesOrderInput,
) {
  const now = new Date();
  const customer = await tx.customer.findUnique({
    where: { id: input.customerId },
  });
  const priceList = await tx.priceList.findFirst({
    where: {
      id: input.priceListId,
      active: true,
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gte: now } }] },
      ],
    },
  });
  if (!customer) throw new Error("Izabrani kupac ne postoji.");
  if (!priceList) throw new Error("Izabrani cenovnik nije aktivan ili ne važi danas.");
  if (!customerLabel(customer)) throw new Error("Kupac nema ime ili naziv firme.");
  if (!customer.address?.trim()) throw new Error("Kupcu nedostaje adresa.");
  if (!customer.city?.trim()) throw new Error("Kupcu nedostaje mesto.");
  if (!customer.postalCode?.trim()) throw new Error("Kupcu nedostaje poštanski broj.");
  if (!customer.phone?.trim()) throw new Error("Kupcu nedostaje telefon.");
  if (!customer.email?.trim()) throw new Error("Kupcu nedostaje e-mail.");
  if (customer.companyName?.trim() && !customer.pib?.trim()) {
    throw new Error("Kupcu-firmi nedostaje PIB.");
  }
  return { customer, priceList };
}

async function lockProductRows(
  tx: Prisma.TransactionClient,
  skus: string[],
) {
  if (!skus.length) return;
  await tx.$queryRaw(
    Prisma.sql`
      SELECT "id"
      FROM "Product"
      WHERE "sku" IN (${Prisma.join(skus)})
      ORDER BY "id"
      FOR UPDATE
    `,
  );
}

async function loadProducts(
  tx: Prisma.TransactionClient,
  skus: string[],
) {
  const products = await tx.product.findMany({
    where: { sku: { in: skus }, deletedAt: null },
    include: productInclude,
  });
  const bySku = new Map(products.map((product) => [product.sku, product]));
  for (const sku of skus) {
    if (!bySku.has(sku)) throw new Error(`Artikal sa šifrom ${sku} ne postoji.`);
  }
  return bySku;
}

async function lockAndLoadProducts(
  tx: Prisma.TransactionClient,
  skus: string[],
) {
  await lockProductRows(tx, skus);
  return loadProducts(tx, skus);
}

function snapshotLine(
  product: LoadedProduct,
  input: ManualSalesOrderInput["lines"][number],
) {
  const names = productNames(product);
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    qty: input.qty,
    unitPriceFull: new Prisma.Decimal(product.fullPrice),
    unitPriceSale: new Prisma.Decimal(input.unitPrice.toFixed(2)),
    supplierName: names.supplier || null,
    categoryName: names.category || null,
    categoryPath: product.categories[0]?.category.path ?? null,
    groupName: names.group || null,
    subgroupName: names.subgroup || null,
    collectionName: names.collection || null,
    shortDescriptionSnapshot: names.shortDescription || null,
    shortNameSnapshot: names.shortName,
    attribute1: names.attribute1 || null,
    attribute2: names.attribute2 || null,
    attribute3: names.attribute3 || null,
    attribute4: names.attribute4 || null,
    color1: names.color1 || null,
    color2: names.color2 || null,
    supplierExternalSku: product.supplierExternalId ?? null,
  } satisfies Prisma.OrderItemCreateManyOrderInput;
}

async function nextManualOrderNumber(
  tx: Prisma.TransactionClient,
  channel: "VP" | "INO",
) {
  const year = new Date().getFullYear();
  const lockKey = `manual-sales-order:${channel}:${year}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  const sequence = await tx.salesOrderSequence.findUnique({
    where: { channel_year: { channel, year } },
    select: { lastValue: true },
  });
  const existingNumbers = await tx.order.findMany({
    where: { number: { startsWith: `${manualOrderNumberPrefix(channel)}-${year}-` } },
    select: { number: true },
  });
  const existingMax = existingNumbers.reduce((max, row) => {
    const parsed = Number.parseInt(row.number.split("-").at(-1) ?? "", 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  const nextValue = Math.max(sequence?.lastValue ?? 0, existingMax) + 1;
  await tx.salesOrderSequence.upsert({
    where: { channel_year: { channel, year } },
    create: { channel, year, lastValue: nextValue },
    update: { lastValue: nextValue },
  });
  return `${manualOrderNumberPrefix(channel)}-${year}-${String(nextValue).padStart(5, "0")}`;
}

async function allocateLines(
  tx: Prisma.TransactionClient,
  args: {
    orderId: string;
    orderNumber: string;
    actorId: string;
    operationKey: string;
    lines: ManualSalesOrderInput["lines"];
    productsBySku: Map<string, LoadedProduct>;
  },
) {
  const items = await tx.orderItem.findMany({
    where: { orderId: args.orderId },
    select: { id: true, sku: true },
  });
  const itemBySku = new Map(items.map((item) => [item.sku, item]));
  const warehouses = await tx.warehouse.findMany({
    where: { active: true },
    select: { id: true, name: true, isDefault: true },
  });
  const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
  const supplierLines = new Map<
    string,
    Array<{
      orderItemId: string;
      productId: string;
      externalSku: string;
      qty: number;
    }>
  >();

  for (const line of args.lines) {
    const product = args.productsBySku.get(line.sku);
    const orderItem = itemBySku.get(line.sku);
    if (!product || !orderItem) throw new Error(`Artikal ${line.sku} nije pripremljen.`);

    if (line.allocation === SUPPLIER_ALLOCATION) {
      if (product.articleStatus !== "DOB" || !product.supplierId) {
        throw new Error(`Artikal ${line.sku} ne može da se vodi kod dobavljača.`);
      }
      const supplierAvailable =
        product.supplier?.integrationKey === "RABALUX"
          ? resolveRabaluxAvailability({
              warehouseStock: 0,
              supplierStock: product.supplierStock,
              supplierReservedStock: product.supplierReservedStock,
              lastSupplierStockSyncAt: product.lastSupplierStockSyncAt,
              supplierOperational: isRabaluxSupplierOperational(product.supplier),
              supplierApproved: product.supplierApprovalStatus === "APPROVED",
            }).supplierAvailable
          : product.supplierStock === null
            ? null
            : product.supplierStock - product.supplierReservedStock;
      if (supplierAvailable !== null && supplierAvailable < line.qty) {
        throw new Error(
          `Dobavljač nema dovoljnu raspoloživu količinu za ${line.sku}.`,
        );
      }
      await tx.product.update({
        where: { id: product.id },
        data: { supplierReservedStock: { increment: line.qty } },
      });
      await syncProductChannelAvailability(tx, product.id);
      await tx.orderItem.update({
        where: { id: orderItem.id },
        data: {
          warehouseId: null,
          warehouseReservedQty: 0,
          supplierReservedQty: line.qty,
        },
      });
      const grouped = supplierLines.get(product.supplierId) ?? [];
      grouped.push({
        orderItemId: orderItem.id,
        productId: product.id,
        externalSku: product.supplierExternalId ?? product.sku,
        qty: line.qty,
      });
      supplierLines.set(product.supplierId, grouped);
      continue;
    }

    const warehouse = warehouseById.get(line.allocation);
    if (!warehouse) throw new Error(`Izabrani magacin za ${line.sku} nije aktivan.`);
    const stockRow = product.warehouseStocks.find(
      (row) => row.warehouseId === warehouse.id,
    );
    const available = stockRow?.qty ?? (warehouse.isDefault ? product.stock : 0);
    if (available < line.qty) {
      throw new Error(
        `Magacin ${warehouse.name} nema dovoljnu količinu za ${line.sku}.`,
      );
    }
    await adjustInventory(tx, {
      idempotencyKey: `manual-sales:${args.orderId}:${args.operationKey}:reserve:${orderItem.id}`,
      productId: product.id,
      sku: product.sku,
      qtyDelta: -line.qty,
      warehouseId: warehouse.id,
      kind: StockMovementKind.SALE_RESERVATION,
      orderId: args.orderId,
      orderItemId: orderItem.id,
      actorId: args.actorId,
      note: `Rezervacija za ručnu porudžbinu ${args.orderNumber}`,
    });
    await tx.orderItem.update({
      where: { id: orderItem.id },
      data: {
        warehouseId: warehouse.id,
        warehouseReservedQty: line.qty,
        supplierReservedQty: 0,
      },
    });
  }

  for (const [supplierId, lines] of supplierLines) {
    await tx.supplierFulfillment.create({
      data: {
        orderId: args.orderId,
        supplierId,
        items: { create: lines },
      },
    });
  }
}

async function releaseManualAllocations(
  tx: Prisma.TransactionClient,
  args: {
    orderId: string;
    orderNumber: string;
    actorId: string;
    operationKey: string;
  },
) {
  const items = await tx.orderItem.findMany({
    where: { orderId: args.orderId },
    select: {
      id: true,
      productId: true,
      sku: true,
      warehouseId: true,
      warehouseReservedQty: true,
      supplierReservedQty: true,
    },
  });
  for (const item of items) {
    if (!item.productId) continue;
    if (item.warehouseReservedQty > 0 && item.warehouseId) {
      await adjustInventory(tx, {
        idempotencyKey: `manual-sales:${args.orderId}:${args.operationKey}:release:${item.id}`,
        productId: item.productId,
        sku: item.sku,
        qtyDelta: item.warehouseReservedQty,
        warehouseId: item.warehouseId,
        kind: StockMovementKind.ADJUSTMENT,
        orderId: args.orderId,
        orderItemId: item.id,
        actorId: args.actorId,
        note: `Oslobađanje rezervacije ručne porudžbine ${args.orderNumber}`,
      });
    }
    if (item.supplierReservedQty > 0) {
      const updated = await tx.product.updateMany({
        where: {
          id: item.productId,
          supplierReservedStock: { gte: item.supplierReservedQty },
        },
        data: {
          supplierReservedStock: { decrement: item.supplierReservedQty },
        },
      });
      if (updated.count !== 1) {
        throw new Error(`Rezervacija dobavljača za ${item.sku} nije usklađena.`);
      }
      await syncProductChannelAvailability(tx, item.productId);
    }
  }
  await tx.supplierFulfillment.deleteMany({ where: { orderId: args.orderId } });
}

function orderTotals(lines: ManualSalesOrderInput["lines"]) {
  return lines.reduce(
    (totals, line) => {
      const lineTotals = calculateSalesLineTotals(line.qty, line.unitPrice);
      totals.net += lineTotals.totalNet;
      totals.gross += lineTotals.totalGross;
      return totals;
    },
    { net: 0, gross: 0 },
  );
}

function orderHeaderData(
  input: ManualSalesOrderInput,
  customer: Awaited<ReturnType<typeof loadCustomerAndPriceList>>["customer"],
  total: number,
) {
  const firstName =
    customer.firstName?.trim() ||
    customer.companyName?.trim() ||
    "Kupac";
  return {
    customerId: customer.id,
    priceListId: input.priceListId,
    guestEmail: customer.email,
    subtotal: new Prisma.Decimal(total.toFixed(2)),
    total: new Prisma.Decimal(total.toFixed(2)),
    shipFirstName: firstName,
    shipLastName: customer.lastName?.trim() ?? "",
    shipPhone: customer.phone!,
    shipStreet: customer.address!,
    shipCity: customer.city!,
    shipPostalCode: customer.postalCode!,
    shipCountry: customer.country,
    shipCompanyName: customer.companyName,
    shipPib: customer.pib,
    sefAcceptedAt: input.sefAccepted ? new Date() : null,
    status: input.status,
  } satisfies Prisma.OrderUncheckedUpdateInput;
}

async function setManualPayment(
  tx: Prisma.TransactionClient,
  args: {
    orderId: string;
    paid: boolean;
    amount: number;
    currency: string;
  },
) {
  const manualPayment = await tx.payment.findFirst({
    where: { orderId: args.orderId, provider: PaymentProvider.MANUAL },
    orderBy: { createdAt: "desc" },
  });
  if (manualPayment) {
    await tx.payment.update({
      where: { id: manualPayment.id },
      data: {
        amount: new Prisma.Decimal(args.amount.toFixed(2)),
        currency: args.currency,
        status: args.paid ? PaymentStatus.PAID : PaymentStatus.PENDING,
        paidAt: args.paid ? manualPayment.paidAt ?? new Date() : null,
      },
    });
    return;
  }
  await tx.payment.create({
    data: {
      orderId: args.orderId,
      method: "UPLATA_NA_RACUN",
      provider: PaymentProvider.MANUAL,
      status: args.paid ? PaymentStatus.PAID : PaymentStatus.PENDING,
      amount: new Prisma.Decimal(args.amount.toFixed(2)),
      currency: args.currency,
      paidAt: args.paid ? new Date() : null,
    },
  });
}

export async function createManualSalesOrder(input: unknown, actorId: string) {
  const data = parseInput(input);
  const operationKey = randomUUID();
  return db.$transaction(async (tx) => {
    const { customer, priceList } = await loadCustomerAndPriceList(tx, data);
    const productsBySku = await lockAndLoadProducts(
      tx,
      data.lines.map((line) => line.sku),
    );
    const number = await nextManualOrderNumber(tx, data.channel);
    const totals = orderTotals(data.lines);
    const order = await tx.order.create({
      data: {
        ...orderHeaderData(data, customer, totals.gross),
        number,
        channel: data.channel,
        shippingMethod: "KURIR",
        paymentMethod: "UPLATA_NA_RACUN",
        termsAcceptedAt: new Date(),
        notes: `Ručna ${data.channel} porudžbina kreirana u ERP-u.`,
        items: {
          createMany: {
            data: data.lines.map((line) =>
              snapshotLine(productsBySku.get(line.sku)!, line),
            ),
          },
        },
        events: {
          create: {
            status: data.status,
            note: `Ručna ${data.channel} porudžbina kreirana u ERP-u.`,
            actorId,
          },
        },
      },
      select: { id: true, number: true },
    });
    await setManualPayment(tx, {
      orderId: order.id,
      paid: data.paid,
      amount: totals.gross,
      currency: priceList.currency,
    });
    await allocateLines(tx, {
      orderId: order.id,
      orderNumber: order.number,
      actorId,
      operationKey,
      lines: data.lines,
      productsBySku,
    });
    return order;
  }, {
    maxWait: 10_000,
    timeout: 30_000,
  });
}

function ensureEditableOrder(order: {
  channel: SalesChannel;
  status: OrderStatus;
  invoices: unknown[];
  fiscalDocuments: unknown[];
  shipments: unknown[];
  dispatchNotes: unknown[];
  dispatchItemCount: number;
  supplierFulfillments: Array<{ sentAt: Date | null }>;
}) {
  if (!MANUAL_CHANNELS.includes(order.channel)) {
    throw new Error("WEB i Ananas porudžbine se ne menjaju kroz ručni VP/INO obrazac.");
  }
  if (!EDITABLE_STATUSES.includes(order.status)) {
    throw new Error("Porudžbina u ovom statusu više nije dostupna za izmenu.");
  }
  if (
    order.invoices.length ||
    order.fiscalDocuments.length ||
    order.shipments.length ||
    order.dispatchNotes.length ||
    order.dispatchItemCount > 0
  ) {
    throw new Error("Obrađena porudžbina sa dokumentima ili isporukom ne može da se menja.");
  }
  if (order.supplierFulfillments.some((fulfillment) => fulfillment.sentAt)) {
    throw new Error("Porudžbina poslata dobavljaču ne može da se menja.");
  }
}

export async function updateManualSalesOrder(
  orderId: string,
  input: unknown,
  actorId: string,
) {
  const data = parseInput(input);
  const operationKey = randomUUID();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`,
    );
    const existing = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        invoices: { select: { id: true } },
        fiscalDocuments: { select: { id: true } },
        shipments: { select: { id: true } },
        dispatchNotes: { select: { id: true } },
        items: {
          select: {
            dispatchNoteItems: {
              where: { dispatchNote: { status: { not: "CANCELLED" } } },
              select: { id: true },
            },
          },
        },
        supplierFulfillments: { select: { sentAt: true } },
      },
    });
    if (!existing) throw new Error("Porudžbina ne postoji.");
    ensureEditableOrder({
      ...existing,
      dispatchItemCount: existing.items.reduce(
        (sum, item) => sum + item.dispatchNoteItems.length,
        0,
      ),
    });
    if (existing.channel !== data.channel) {
      throw new Error("Kanal postojeće porudžbine ne može da se promeni.");
    }
    const { customer, priceList } = await loadCustomerAndPriceList(tx, data);
    const previousItems = await tx.orderItem.findMany({
      where: { orderId },
      select: { sku: true },
    });
    const nextSkus = data.lines.map((line) => line.sku);
    await lockProductRows(
      tx,
      Array.from(new Set([...previousItems.map((item) => item.sku), ...nextSkus])),
    );
    await releaseManualAllocations(tx, {
      orderId,
      orderNumber: existing.number,
      actorId,
      operationKey,
    });
    const productsBySku = await loadProducts(tx, nextSkus);
    await tx.orderItem.deleteMany({ where: { orderId } });
    const totals = orderTotals(data.lines);
    await tx.order.update({
      where: { id: orderId },
      data: {
        ...orderHeaderData(data, customer, totals.gross),
        items: {
          createMany: {
            data: data.lines.map((line) =>
              snapshotLine(productsBySku.get(line.sku)!, line),
            ),
          },
        },
        ...(existing.status !== data.status
          ? {
              events: {
                create: {
                  status: data.status,
                  note: "Status promenjen kroz ERP pregled porudžbine.",
                  actorId,
                },
              },
            }
          : {}),
      },
    });
    await setManualPayment(tx, {
      orderId,
      paid: data.paid,
      amount: totals.gross,
      currency: priceList.currency,
    });
    await allocateLines(tx, {
      orderId,
      orderNumber: existing.number,
      actorId,
      operationKey,
      lines: data.lines,
      productsBySku,
    });
    return { id: orderId, number: existing.number };
  }, {
    maxWait: 10_000,
    timeout: 30_000,
  });
}

export async function deleteManualSalesOrders(
  selectedRowIds: string[],
  actorId: string,
) {
  if (!selectedRowIds.length) throw new Error("Izaberite bar jedan red.");
  const operationKey = randomUUID();
  return db.$transaction(async (tx) => {
    const resolvedOrders = await tx.order.findMany({
      where: {
        OR: [
          { id: { in: selectedRowIds } },
          { items: { some: { id: { in: selectedRowIds } } } },
        ],
      },
      select: { id: true },
    });
    if (!resolvedOrders.length) throw new Error("Izabrana porudžbina ne postoji.");
    const orderIds = resolvedOrders.map((order) => order.id).sort();
    for (const orderId of orderIds) {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`,
      );
    }
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds } },
      include: {
        items: {
          select: {
            id: true,
            sku: true,
            dispatchNoteItems: {
              where: { dispatchNote: { status: { not: "CANCELLED" } } },
              select: { id: true },
            },
          },
        },
        payments: { select: { status: true } },
        invoices: { select: { id: true } },
        fiscalDocuments: { select: { id: true } },
        shipments: { select: { id: true } },
        dispatchNotes: { select: { id: true } },
        supplierFulfillments: { select: { sentAt: true } },
      },
    });
    if (orders.length !== orderIds.length) {
      throw new Error("Jedna od izabranih porudžbina više ne postoji.");
    }
    await lockProductRows(
      tx,
      Array.from(
        new Set(orders.flatMap((order) => order.items.map((item) => item.sku))),
      ),
    );
    for (const order of orders) {
      ensureEditableOrder({
        ...order,
        dispatchItemCount: order.items.reduce(
          (sum, item) => sum + item.dispatchNoteItems.length,
          0,
        ),
      });
      if (order.status !== "KREIRANO") {
        throw new Error(`Samo kreirana porudžbina može da se obriše (${order.number}).`);
      }
      if (order.payments.some((payment) => payment.status === "PAID")) {
        throw new Error(`Plaćena porudžbina ${order.number} ne može da se obriše.`);
      }
    }
    for (const order of orders) {
      await releaseManualAllocations(tx, {
        orderId: order.id,
        orderNumber: order.number,
        actorId,
        operationKey: `${operationKey}:${order.id}`,
      });
      await tx.order.delete({ where: { id: order.id } });
    }
    return orders.map((order) => ({ id: order.id, number: order.number }));
  }, {
    maxWait: 10_000,
    timeout: 30_000,
  });
}

export async function getSalesOrderDetail(
  orderId: string,
): Promise<SalesOrderDetail | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      priceList: true,
      items: {
        orderBy: { id: "asc" },
        include: {
          product: { include: productInclude },
          dispatchNoteItems: {
            where: { dispatchNote: { status: { not: "CANCELLED" } } },
            select: { id: true },
          },
        },
      },
      payments: { orderBy: { createdAt: "desc" } },
      invoices: { where: { status: { not: "CANCELLED" } }, select: { id: true } },
      fiscalDocuments: {
        where: { kind: "SALE", status: "ISSUED" },
        select: { id: true },
      },
      fiscal: { select: { id: true } },
      shipments: { select: { id: true } },
      dispatchNotes: { select: { id: true } },
      supplierFulfillments: { select: { sentAt: true } },
    },
  });
  if (!order) return null;
  const operational = {
    channel: order.channel,
    status: order.status,
    invoices: order.invoices,
    fiscalDocuments: order.fiscalDocuments,
    shipments: order.shipments,
    dispatchNotes: order.dispatchNotes,
    dispatchItemCount: order.items.reduce(
      (sum, item) => sum + item.dispatchNoteItems.length,
      0,
    ),
    supplierFulfillments: order.supplierFulfillments,
  };
  let canEdit = true;
  try {
    ensureEditableOrder(operational);
  } catch {
    canEdit = false;
  }
  const paid = order.payments.some((payment) => payment.status === "PAID");
  const defaultWarehouse = await db.warehouse.findFirst({
    where: { active: true, isDefault: true },
    select: { id: true },
  });
  const lines: SalesOrderFormLine[] = [];
  for (const item of order.items) {
      if (item.product) {
        const data = await productData(
          item.product,
          order.priceListId ?? "",
          numberValue(item.unitPriceSale),
        );
        const suggestion = resolveSalesOrderWarehouse({
          articleStatus: item.product.articleStatus,
          dcAvailableQty:
            item.product.warehouseStocks.find((row) => row.warehouse.isDefault)?.qty ??
            item.product.stock,
          defaultWarehouseId: defaultWarehouse?.id ?? null,
        });
        lines.push({
          ...data,
          id: item.id,
          qty: item.qty,
          allocation:
            item.warehouseId ??
            (item.supplierReservedQty > 0
              ? SUPPLIER_ALLOCATION
              : suggestion?.type === "SUPPLIER"
                ? SUPPLIER_ALLOCATION
                : suggestion?.type === "WAREHOUSE"
                  ? suggestion.warehouseId
                  : ""),
        });
        continue;
      }
      lines.push({
        productId: item.productId ?? "",
        sku: item.sku,
        articleStatus: "",
        supplierId: null,
        supplier: item.supplierName ?? "",
        category: item.categoryName ?? "",
        group: item.groupName ?? "",
        subgroup: item.subgroupName ?? "",
        collection: item.collectionName ?? "",
        shortDescription: item.shortDescriptionSnapshot ?? "",
        shortName: item.shortNameSnapshot ?? item.name,
        attribute1: item.attribute1 ?? "",
        attribute2: item.attribute2 ?? "",
        attribute3: item.attribute3 ?? "",
        attribute4: item.attribute4 ?? "",
        color1: item.color1 ?? "",
        color2: item.color2 ?? "",
        unitPrice: numberValue(item.unitPriceSale),
        priceSource: "Sačuvana cena porudžbine",
        defaultAllocation: item.warehouseId ?? "",
        supplierAllocationAllowed: item.supplierReservedQty > 0,
        warehouseAvailability: {},
        id: item.id,
        qty: item.qty,
        allocation:
          item.warehouseId ??
          (item.supplierReservedQty > 0 ? SUPPLIER_ALLOCATION : ""),
      });
  }
  return {
    id: order.id,
    number: order.number,
    channel: order.channel,
    status: order.status,
    customerId: order.customerId ?? "",
    priceListId: order.priceListId ?? "",
    currency: order.priceList?.currency ?? order.payments[0]?.currency ?? "RSD",
    paid,
    sefAccepted: Boolean(order.sefAcceptedAt),
    fiscalized: Boolean(order.fiscal || order.fiscalDocuments.length),
    invoiced: order.invoices.length > 0,
    canEdit,
    canDelete:
      canEdit &&
      order.status === "KREIRANO" &&
      !paid &&
      MANUAL_CHANNELS.includes(order.channel),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    customerSnapshot: customerSnapshotFromOrder(order),
    lines,
  };
}
