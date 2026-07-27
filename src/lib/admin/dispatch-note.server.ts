import "server-only";

import {
  DispatchNoteType,
  DocumentPostingStatus,
  Prisma,
  SalesChannel,
  StockMovementKind,
} from "@prisma/client";
import { db } from "@/lib/db";
import { envValue } from "@/lib/env";
import { adjustInventory } from "@/lib/inventory";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import {
  DISPATCH_NOTE_VAT_RATE,
  buildDispatchNoteUbl,
  calculateDispatchLineTotals,
  calculateDispatchTotals,
  dispatchNoteInputSchema,
  isInternalDispatch,
  type DispatchNoteInput,
} from "@/lib/admin/dispatch-note";

const IMPORT_CHANNELS: SalesChannel[] = [
  SalesChannel.VP,
  SalesChannel.INO,
];

const productInclude = {
  supplier: { select: { name: true } },
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
} satisfies Prisma.ProductInclude;

type LoadedProduct = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

export type DispatchCompanyOption = {
  id: string;
  label: string;
  companyName: string;
  pib: string;
  registrationNumber: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
};

export type DispatchWarehouseOption = {
  id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  isDefault: boolean;
};

export type DispatchNoteFormOptions = {
  companies: DispatchCompanyOption[];
  warehouses: DispatchWarehouseOption[];
  defaultIssuerCustomerId: string;
  defaultWarehouseId: string;
};

export type DispatchProductData = {
  productId: string;
  sku: string;
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
  unitPriceGross: number;
  priceSource: string;
};

export type DispatchNoteFormLine = DispatchProductData & {
  id?: string;
  orderItemId: string | null;
  sourceOrderNumber: string;
  qty: number;
  maxQty: number | null;
};

export type DispatchNoteDetail = {
  id: string;
  number: string;
  type: string;
  status: string;
  issueDate: string;
  issuerCustomerId: string;
  receiverCustomerId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  showPrices: boolean;
  currency: string;
  notes: string;
  importFrom: string;
  importTo: string;
  shipmentMethod: number;
  carrierCustomerId: string;
  licensePlate: string;
  courierFirstName: string;
  courierLastName: string;
  courierIdNumber: string;
  actualDispatchAt: string;
  plannedDeliveryAt: string;
  totalNet: number;
  totalVat: number;
  totalGross: number;
  postedAt: string;
  sefSentAt: string;
  sefStatus: string;
  sefError: string;
  canEdit: boolean;
  canDelete: boolean;
  canPost: boolean;
  canSendToSef: boolean;
  issuer: DispatchCompanyOption;
  receiver: DispatchCompanyOption;
  carrier: DispatchCompanyOption | null;
  lines: DispatchNoteFormLine[];
};

type CompanyRecord = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  pib: string | null;
  registrationNumber: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
};

type PreparedLine = DispatchNoteFormLine & {
  orderId: string | null;
  vatRate: number;
  totalNet: number;
  totalVat: number;
  totalGross: number;
};

function decimal(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

function companyLabel(company: CompanyRecord) {
  return (
    company.companyName?.trim() ||
    [company.firstName, company.lastName].filter(Boolean).join(" ").trim() ||
    "Firma bez naziva"
  );
}

function companyOption(company: CompanyRecord): DispatchCompanyOption {
  return {
    id: company.id,
    label: companyLabel(company),
    companyName: company.companyName ?? "",
    pib: company.pib ?? "",
    registrationNumber: company.registrationNumber ?? "",
    address: company.address ?? "",
    city: company.city ?? "",
    postalCode: company.postalCode ?? "",
    country: company.country,
    phone: company.phone ?? "",
    email: company.email ?? "",
  };
}

function requireCompanyData(company: CompanyRecord, role: string) {
  if (!company.companyName?.trim()) {
    throw new Error(`${role} mora imati naziv firme u bazi kupaca.`);
  }
  if (!company.pib?.trim()) throw new Error(`${role} nema PIB.`);
  if (!company.address?.trim()) throw new Error(`${role} nema adresu.`);
  if (!company.city?.trim()) throw new Error(`${role} nema mesto.`);
  if (!company.postalCode?.trim()) {
    throw new Error(`${role} nema poštanski broj.`);
  }
}

function companySnapshot(
  prefix: "issuer" | "receiver" | "carrier",
  company: CompanyRecord,
) {
  return {
    [`${prefix}CustomerId`]: company.id,
    [`${prefix}Name`]: company.companyName!.trim(),
    [`${prefix}Pib`]: company.pib!.trim(),
    [`${prefix}RegistrationNumber`]: company.registrationNumber?.trim() || "",
    [`${prefix}Address`]: company.address!.trim(),
    [`${prefix}City`]: company.city!.trim(),
    [`${prefix}PostalCode`]: company.postalCode!.trim(),
    [`${prefix}Country`]: company.country || "RS",
    [`${prefix}Phone`]: company.phone?.trim() || null,
    [`${prefix}Email`]: company.email?.trim() || null,
  };
}

function productMetadata(product: LoadedProduct) {
  const leaf = product.categories[0]?.category ?? null;
  return {
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

async function resolveDispatchPrice(
  tx: Prisma.TransactionClient,
  product: LoadedProduct,
  receiverCustomerId: string,
) {
  const now = new Date();
  const recentOrder = await tx.order.findFirst({
    where: {
      customerId: receiverCustomerId,
      priceListId: { not: null },
      channel: { in: IMPORT_CHANNELS },
    },
    orderBy: { createdAt: "desc" },
    select: { priceListId: true },
  });
  if (recentOrder?.priceListId) {
    const entry = await tx.priceListEntry.findFirst({
      where: {
        priceListId: recentOrder.priceListId,
        productId: product.id,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      orderBy: { validFrom: "desc" },
      include: { priceList: { select: { code: true, name: true } } },
    });
    if (entry) {
      return {
        price: decimal(entry.price),
        source: `Cenovnik kupca ${entry.priceList.code} · ${entry.priceList.name}`,
      };
    }
  }

  const lists = await tx.priceList.findMany({
    where: {
      active: true,
      kind: { in: ["WHOLESALE", "EXPORT", "RETAIL"] },
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gte: now } }] },
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, code: true, name: true, kind: true },
  });
  lists.sort(
    (left, right) =>
      ["WHOLESALE", "EXPORT", "RETAIL"].indexOf(left.kind) -
      ["WHOLESALE", "EXPORT", "RETAIL"].indexOf(right.kind),
  );
  for (const list of lists) {
    const entry = await tx.priceListEntry.findFirst({
      where: {
        priceListId: list.id,
        productId: product.id,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      orderBy: { validFrom: "desc" },
    });
    if (entry) {
      return {
        price: decimal(entry.price),
        source: `${list.kind} cenovnik ${list.code} · ${list.name}`,
      };
    }
  }
  return {
    price: decimal(product.fullPrice),
    source: "Matična MP cena artikla",
  };
}

function productFormData(
  product: LoadedProduct,
  price: number,
  priceSource: string,
): DispatchProductData {
  return {
    productId: product.id,
    sku: product.sku,
    ...productMetadata(product),
    unitPriceGross: price,
    priceSource,
  };
}

function parseInput(input: unknown) {
  const parsed = dispatchNoteInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues.map((issue) => issue.message).join(" "),
    );
  }
  return parsed.data;
}

function dateAtUtcMidnight(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Datum nije ispravan.");
  return parsed;
}

function optionalDate(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Datum i vreme nisu ispravni.");
  return parsed;
}

function dateOnly(value: Date | null | undefined) {
  return value?.toISOString().slice(0, 10) ?? "";
}

function dateTime(value: Date | null | undefined) {
  return value?.toISOString() ?? "";
}

function belgradeDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function getDispatchNoteFormOptions(): Promise<DispatchNoteFormOptions> {
  const [companies, warehouses] = await Promise.all([
    db.customer.findMany({
      where: { companyName: { not: null } },
      take: 3_000,
      orderBy: [{ companyName: "asc" }, { lastName: "asc" }],
    }),
    db.warehouse.findMany({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
  ]);
  const options = companies.map(companyOption);
  return {
    companies: options,
    warehouses: warehouses.map((warehouse) => ({
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name,
      address: warehouse.address ?? "",
      city: warehouse.city ?? "",
      isDefault: warehouse.isDefault,
    })),
    defaultIssuerCustomerId:
      options.find((company) => company.pib === MERCHANT_LEGAL_INFO.pib)?.id ?? "",
    defaultWarehouseId:
      warehouses.find((warehouse) => warehouse.isDefault)?.id ?? "",
  };
}

export async function getDispatchNoteProduct(
  sku: string,
  receiverCustomerId: string,
): Promise<DispatchProductData> {
  const normalizedSku = sku.trim();
  if (!normalizedSku) throw new Error("Unesite šifru artikla.");
  if (!receiverCustomerId) throw new Error("Prvo izaberite firmu primaoca.");
  return db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { sku: normalizedSku },
      include: productInclude,
    });
    if (!product || product.deletedAt) {
      throw new Error(`Artikal sa šifrom ${normalizedSku} ne postoji.`);
    }
    const price = await resolveDispatchPrice(tx, product, receiverCustomerId);
    return productFormData(product, price.price, price.source);
  });
}

async function allocatedOrderQuantities(
  tx: Prisma.TransactionClient,
  orderItemIds: string[],
  excludeDispatchId?: string | null,
) {
  if (!orderItemIds.length) return new Map<string, number>();
  const rows = await tx.dispatchNoteItem.groupBy({
    by: ["orderItemId"],
    where: {
      orderItemId: { in: orderItemIds },
      dispatchNote: {
        status: { not: DocumentPostingStatus.CANCELLED },
        ...(excludeDispatchId ? { id: { not: excludeDispatchId } } : {}),
      },
    },
    _sum: { qty: true },
  });
  return new Map(
    rows
      .filter(
        (row): row is typeof row & { orderItemId: string } =>
          Boolean(row.orderItemId),
      )
      .map((row) => [row.orderItemId, row._sum.qty ?? 0]),
  );
}

function originalWarehouseAllocation(item: {
  qty: number;
  warehouseReservedQty: number;
  warehouseDispatchedQty: number;
  supplierReservedQty: number;
}) {
  const tracked = item.warehouseReservedQty + item.warehouseDispatchedQty;
  if (tracked > 0) return tracked;
  return item.supplierReservedQty === 0 ? item.qty : 0;
}

async function prepareLines(
  tx: Prisma.TransactionClient,
  data: DispatchNoteInput,
  excludeDispatchId?: string | null,
): Promise<PreparedLine[]> {
  const orderItemIds = data.lines
    .map((line) => line.orderItemId)
    .filter((id): id is string => Boolean(id));
  if (orderItemIds.length) {
    await tx.$queryRaw(
      Prisma.sql`
        SELECT "id"
        FROM "OrderItem"
        WHERE "id" IN (${Prisma.join(orderItemIds)})
        ORDER BY "id"
        FOR UPDATE
      `,
    );
  }
  const [orderItems, allocations] = await Promise.all([
    tx.orderItem.findMany({
      where: { id: { in: orderItemIds } },
      include: {
        order: {
          select: {
            id: true,
            number: true,
            customerId: true,
            channel: true,
            status: true,
          },
        },
        product: { include: productInclude },
      },
    }),
    allocatedOrderQuantities(tx, orderItemIds, excludeDispatchId),
  ]);
  const orderItemById = new Map(orderItems.map((item) => [item.id, item]));
  const manualSkus = data.lines
    .filter((line) => !line.orderItemId)
    .map((line) => line.sku);
  const manualProducts = await tx.product.findMany({
    where: { sku: { in: manualSkus }, deletedAt: null },
    include: productInclude,
  });
  const productBySku = new Map(
    manualProducts.map((product) => [product.sku, product]),
  );
  const internal = isInternalDispatch(data);
  const prepared: PreparedLine[] = [];

  for (const line of data.lines) {
    if (line.orderItemId) {
      if (internal) {
        throw new Error(
          "Interni prenos ne može sadržati stavke učitane iz prodajnih porudžbina.",
        );
      }
      const item = orderItemById.get(line.orderItemId);
      if (!item || !item.product) {
        throw new Error(`Stavka porudžbine za ${line.sku} više ne postoji.`);
      }
      if (item.sku !== line.sku) {
        throw new Error("Šifra ne odgovara izabranoj stavci porudžbine.");
      }
      if (item.order.customerId !== data.receiverCustomerId) {
        throw new Error(
          `Porudžbina ${item.order.number} ne pripada izabranoj firmi primaocu.`,
        );
      }
      if (
        item.order.status === "ISPORUCENO" ||
        item.order.status === "OTKAZANO" ||
        item.order.status === "VRACENO"
      ) {
        throw new Error(`Porudžbina ${item.order.number} nije aktivna.`);
      }
      if (item.warehouseId !== data.sourceWarehouseId) {
        throw new Error(
          `Stavka ${item.sku} nije rezervisana u izabranom izvornom magacinu.`,
        );
      }
      const available =
        originalWarehouseAllocation(item) - (allocations.get(item.id) ?? 0);
      if (line.qty > available) {
        throw new Error(
          `Za ${item.sku} je za otpremu dostupno najviše ${Math.max(available, 0)} kom.`,
        );
      }
      const metadata = productMetadata(item.product);
      const unitPriceGross = internal ? 0 : decimal(item.unitPriceSale);
      const totals = calculateDispatchLineTotals(line.qty, unitPriceGross);
      prepared.push({
        id: undefined,
        orderId: item.order.id,
        orderItemId: item.id,
        sourceOrderNumber: item.order.number,
        productId: item.product.id,
        sku: item.sku,
        subgroup: item.subgroupName ?? metadata.subgroup,
        collection: item.collectionName ?? metadata.collection,
        shortDescription:
          item.shortDescriptionSnapshot ?? metadata.shortDescription,
        shortName: item.shortNameSnapshot ?? metadata.shortName,
        attribute1: item.attribute1 ?? metadata.attribute1,
        attribute2: item.attribute2 ?? metadata.attribute2,
        attribute3: item.attribute3 ?? metadata.attribute3,
        attribute4: item.attribute4 ?? metadata.attribute4,
        color1: item.color1 ?? metadata.color1,
        color2: item.color2 ?? metadata.color2,
        unitPriceGross,
        priceSource: "Sačuvana cena porudžbine",
        qty: line.qty,
        maxQty: available,
        vatRate: DISPATCH_NOTE_VAT_RATE,
        ...totals,
      });
      continue;
    }

    const product = productBySku.get(line.sku);
    if (!product) {
      throw new Error(`Artikal sa šifrom ${line.sku} ne postoji.`);
    }
    const price = internal
      ? { price: 0, source: "Interni prenos bez cena" }
      : await resolveDispatchPrice(tx, product, data.receiverCustomerId);
    const totals = calculateDispatchLineTotals(line.qty, price.price);
    prepared.push({
      id: undefined,
      orderId: null,
      orderItemId: null,
      sourceOrderNumber: "",
      ...productFormData(product, price.price, price.source),
      qty: line.qty,
      maxQty: null,
      vatRate: DISPATCH_NOTE_VAT_RATE,
      ...totals,
    });
  }
  return prepared;
}

async function loadHeaderReferences(
  tx: Prisma.TransactionClient,
  data: DispatchNoteInput,
) {
  const [issuer, receiver, requestedCarrier, sourceWarehouse, destinationWarehouse] =
    await Promise.all([
      tx.customer.findUnique({ where: { id: data.issuerCustomerId } }),
      tx.customer.findUnique({ where: { id: data.receiverCustomerId } }),
      data.carrierCustomerId
        ? tx.customer.findUnique({ where: { id: data.carrierCustomerId } })
        : Promise.resolve(null),
      tx.warehouse.findFirst({
        where: { id: data.sourceWarehouseId, active: true },
      }),
      data.destinationWarehouseId
        ? tx.warehouse.findFirst({
            where: { id: data.destinationWarehouseId, active: true },
          })
        : Promise.resolve(null),
    ]);
  if (!issuer) throw new Error("Firma izdavalac ne postoji.");
  if (!receiver) throw new Error("Firma primalac ne postoji.");
  requireCompanyData(issuer, "Firma izdavalac");
  requireCompanyData(receiver, "Firma primalac");
  if (!sourceWarehouse) throw new Error("Izvorni magacin nije aktivan.");
  const internal = isInternalDispatch(data);
  if (internal && !destinationWarehouse) {
    throw new Error("Odredišni magacin nije aktivan.");
  }
  const carrier =
    data.shipmentMethod === 1
      ? issuer
      : data.shipmentMethod === 3
        ? receiver
        : data.shipmentMethod === 2
          ? requestedCarrier
          : null;
  if (data.shipmentMethod === 2 && data.carrierCustomerId && !carrier) {
    throw new Error("Izabrani prevoznik ne postoji u bazi kupaca.");
  }
  if (carrier) requireCompanyData(carrier, "Prevoznik");
  return {
    issuer,
    receiver,
    sourceWarehouse,
    destinationWarehouse,
    carrier,
    internal,
  };
}

async function nextDispatchNumber(
  tx: Prisma.TransactionClient,
  sourceOrderNumbers: string[],
  currentDispatchId?: string,
) {
  if (sourceOrderNumbers.length === 1) {
    const number = sourceOrderNumbers[0]!;
    const existing = await tx.dispatchNote.findUnique({
      where: { number },
      select: { id: true },
    });
    if (existing && existing.id !== currentDispatchId) {
      throw new Error(
        `Otpremnica sa brojem porudžbine ${number} već postoji.`,
      );
    }
    return number;
  }
  const year = new Date().getFullYear();
  const prefix = `OTP-${year}-`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dispatch-note:${year}`}))`;
  const rows = await tx.dispatchNote.findMany({
    where: { number: { startsWith: prefix } },
    select: { number: true },
  });
  const max = rows.reduce((current, row) => {
    const value = Number.parseInt(row.number.slice(prefix.length), 10);
    return Number.isFinite(value) ? Math.max(current, value) : current;
  }, 0);
  return `${prefix}${String(max + 1).padStart(5, "0")}`;
}

function itemCreateData(line: PreparedLine) {
  return {
    orderItemId: line.orderItemId,
    productId: line.productId,
    sku: line.sku,
    name: line.shortName,
    qty: line.qty,
    sourceOrderNumber: line.sourceOrderNumber || null,
    subgroup: line.subgroup || null,
    collection: line.collection || null,
    shortDescription: line.shortDescription || null,
    shortName: line.shortName || null,
    attribute1: line.attribute1 || null,
    attribute2: line.attribute2 || null,
    attribute3: line.attribute3 || null,
    attribute4: line.attribute4 || null,
    color1: line.color1 || null,
    color2: line.color2 || null,
    unitPriceGross: new Prisma.Decimal(line.unitPriceGross.toFixed(2)),
    vatRate: new Prisma.Decimal(line.vatRate.toFixed(2)),
    totalNet: new Prisma.Decimal(line.totalNet.toFixed(2)),
    totalVat: new Prisma.Decimal(line.totalVat.toFixed(2)),
    totalGross: new Prisma.Decimal(line.totalGross.toFixed(2)),
  } satisfies Prisma.DispatchNoteItemUncheckedCreateWithoutDispatchNoteInput;
}

function headerData(
  data: DispatchNoteInput,
  references: Awaited<ReturnType<typeof loadHeaderReferences>>,
  lines: PreparedLine[],
) {
  const orderIds = Array.from(
    new Set(lines.map((line) => line.orderId).filter(Boolean)),
  ) as string[];
  const orderReference = Array.from(
    new Set(
      lines
        .map((line) => line.sourceOrderNumber)
        .filter((value): value is string => Boolean(value)),
    ),
  ).join(", ");
  if (orderReference.length > 500) {
    throw new Error(
      "Zajednička referenca porudžbina prelazi dozvoljenih 500 karaktera; izaberite kraći period ili podelite otpremnicu.",
    );
  }
  const totals = calculateDispatchTotals(lines);
  const showPrices = references.internal ? false : data.showPrices;
  const carrierSnapshot = references.carrier
    ? companySnapshot("carrier", references.carrier)
    : {
        carrierCustomerId: null,
        carrierName: null,
        carrierPib: null,
        carrierRegistrationNumber: null,
        carrierAddress: null,
        carrierCity: null,
        carrierPostalCode: null,
        carrierCountry: null,
        carrierPhone: null,
        carrierEmail: null,
      };
  return {
    type: references.internal
      ? DispatchNoteType.INTERNAL
      : DispatchNoteType.CUSTOMER,
    issueDate: dateAtUtcMidnight(data.issueDate),
    orderId: orderIds.length === 1 ? orderIds[0] : null,
    sourceWarehouseId: references.sourceWarehouse.id,
    destinationWarehouseId: references.internal
      ? references.destinationWarehouse?.id ?? null
      : null,
    destinationName: references.internal
      ? references.destinationWarehouse?.name ?? null
      : references.receiver.companyName,
    destinationAddress: references.internal
      ? references.destinationWarehouse?.address ?? null
      : references.receiver.address,
    destinationCity: references.internal
      ? references.destinationWarehouse?.city ?? null
      : references.receiver.city,
    ...companySnapshot("issuer", references.issuer),
    ...companySnapshot("receiver", references.receiver),
    ...carrierSnapshot,
    showPrices,
    currency: "RSD",
    totalNet: new Prisma.Decimal((references.internal ? 0 : totals.net).toFixed(2)),
    totalVat: new Prisma.Decimal((references.internal ? 0 : totals.vat).toFixed(2)),
    totalGross: new Prisma.Decimal(
      (references.internal ? 0 : totals.gross).toFixed(2),
    ),
    importFrom: data.importFrom ? dateAtUtcMidnight(data.importFrom) : null,
    importTo: data.importTo ? dateAtUtcMidnight(data.importTo) : null,
    shipmentMethod: data.shipmentMethod,
    licensePlate: data.licensePlate?.trim().toUpperCase() || null,
    courierFirstName: data.courierFirstName?.trim() || null,
    courierLastName: data.courierLastName?.trim() || null,
    courierIdNumber: data.courierIdNumber?.trim() || null,
    actualDispatchAt: optionalDate(data.actualDispatchAt),
    plannedDeliveryAt: optionalDate(data.plannedDeliveryAt),
    notes: data.notes?.trim() || null,
  };
}

export async function createDispatchNote(input: unknown, actorId: string) {
  const data = parseInput(input);
  return db.$transaction(
    async (tx) => {
      const references = await loadHeaderReferences(tx, data);
      const lines = await prepareLines(tx, data);
      const sourceOrderNumbers = Array.from(
        new Set(
          lines
            .map((line) => line.sourceOrderNumber)
            .filter((number): number is string => Boolean(number)),
        ),
      );
      const number = await nextDispatchNumber(tx, sourceOrderNumbers);
      return tx.dispatchNote.create({
        data: {
          number,
          status: DocumentPostingStatus.DRAFT,
          actorId,
          ...headerData(data, references, lines),
          items: { create: lines.map(itemCreateData) },
        },
        select: { id: true, number: true },
      });
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

export async function updateDispatchNote(
  id: string,
  input: unknown,
  actorId: string,
) {
  const data = parseInput(input);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "DispatchNote" WHERE "id" = ${id} FOR UPDATE`,
      );
      const existing = await tx.dispatchNote.findUnique({ where: { id } });
      if (!existing) throw new Error("Otpremnica ne postoji.");
      if (existing.status !== DocumentPostingStatus.DRAFT) {
        throw new Error("Proknjižena otpremnica ne može da se menja.");
      }
      if (existing.sefSentAt) {
        throw new Error("Otpremnica poslata na SEF ne može da se menja.");
      }
      const references = await loadHeaderReferences(tx, data);
      const lines = await prepareLines(tx, data, id);
      const sourceOrderNumbers = Array.from(
        new Set(
          lines
            .map((line) => line.sourceOrderNumber)
            .filter((number): number is string => Boolean(number)),
        ),
      );
      const number =
        sourceOrderNumbers.length === 1 || !existing.number.startsWith("OTP-")
          ? await nextDispatchNumber(tx, sourceOrderNumbers, existing.id)
          : existing.number;
      await tx.dispatchNoteItem.deleteMany({ where: { dispatchNoteId: id } });
      await tx.dispatchNote.update({
        where: { id },
        data: {
          number,
          actorId,
          ...headerData(data, references, lines),
          items: { create: lines.map(itemCreateData) },
        },
      });
      return { id, number };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

export async function deleteDispatchNotes(ids: string[]) {
  if (!ids.length) throw new Error("Izaberite bar jednu otpremnicu.");
  return db.$transaction(async (tx) => {
    const notes = await tx.dispatchNote.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        number: true,
        status: true,
        sefSentAt: true,
      },
    });
    if (notes.length !== new Set(ids).size) {
      throw new Error("Jedna od izabranih otpremnica ne postoji.");
    }
    for (const note of notes) {
      if (note.status !== DocumentPostingStatus.DRAFT || note.sefSentAt) {
        throw new Error(
          `Otpremnica ${note.number} je zaključana i ne može da se obriše.`,
        );
      }
    }
    await tx.dispatchNote.deleteMany({ where: { id: { in: ids } } });
    return notes.map((note) => ({ id: note.id, number: note.number }));
  });
}

async function recordReservedDispatch(
  tx: Prisma.TransactionClient,
  input: {
    dispatchNoteId: string;
    warehouseId: string;
    productId: string;
    orderId: string;
    orderItemId: string;
    sku: string;
    quantity: number;
    number: string;
    actorId: string;
  },
) {
  const existing = await tx.stockMovement.findUnique({
    where: {
      idempotencyKey: `dispatch:${input.dispatchNoteId}:${input.orderItemId}:reserved`,
    },
  });
  if (existing) return;
  const [warehouseStock, product] = await Promise.all([
    tx.warehouseStock.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId: input.warehouseId,
          productId: input.productId,
        },
      },
      select: { qty: true },
    }),
    tx.product.findUnique({
      where: { id: input.productId },
      select: { stock: true },
    }),
  ]);
  await tx.stockMovement.create({
    data: {
      idempotencyKey: `dispatch:${input.dispatchNoteId}:${input.orderItemId}:reserved`,
      dispatchNoteId: input.dispatchNoteId,
      warehouseId: input.warehouseId,
      productId: input.productId,
      orderId: input.orderId,
      orderItemId: input.orderItemId,
      kind: StockMovementKind.DISPATCH,
      sku: input.sku,
      qty: 0,
      note: `Otpremnica ${input.number}: ${input.quantity} kom. skinuto je kroz raniju rezervaciju porudžbine.`,
      actorId: input.actorId,
      balanceAfterWarehouse: warehouseStock?.qty ?? null,
      balanceAfterTotal: product?.stock ?? null,
    },
  });
}

type DispatchWithWarehouses = Prisma.DispatchNoteGetPayload<{
  include: { sourceWarehouse: true; destinationWarehouse: true };
}>;

function assertDispatchTransportComplete(
  dispatch: DispatchWithWarehouses,
) {
  if (!dispatch.actualDispatchAt || !dispatch.plannedDeliveryAt) {
    throw new Error(
      "Unesite stvarno vreme otpreme i planirano vreme isporuke pre knjiženja.",
    );
  }
  if (dispatch.plannedDeliveryAt < dispatch.actualDispatchAt) {
    throw new Error(
      "Planirano vreme isporuke mora biti nakon stvarnog vremena otpreme.",
    );
  }
  if (belgradeDate(dispatch.actualDispatchAt) < dateOnly(dispatch.issueDate)) {
    throw new Error(
      "Stvarno vreme otpreme ne može biti pre datuma izdavanja otpremnice.",
    );
  }
  if (!dispatch.sourceWarehouse.active) {
    throw new Error("Izvorni magacin više nije aktivan.");
  }
  if (!dispatch.sourceWarehouse.address || !dispatch.sourceWarehouse.city) {
    throw new Error("Izvorni magacin mora imati adresu i mesto.");
  }
  if (
    dispatch.type === DispatchNoteType.INTERNAL &&
    (!dispatch.destinationWarehouse?.active ||
      !dispatch.destinationAddress ||
      !dispatch.destinationCity)
  ) {
    throw new Error("Odredišni magacin mora biti aktivan i imati adresu i mesto.");
  }
  for (const [label, value] of [
    ["PIB izdavaoca", dispatch.issuerPib],
    ["matični broj izdavaoca", dispatch.issuerRegistrationNumber],
    ["PIB primaoca", dispatch.receiverPib],
    ["adresa izdavaoca", dispatch.issuerAddress],
    ["adresa primaoca", dispatch.receiverAddress],
  ]) {
    if (!value.trim()) throw new Error(`Nedostaje ${label}.`);
  }
  if (
    dispatch.receiverCountry.toUpperCase() === "RS" &&
    !dispatch.receiverRegistrationNumber.trim()
  ) {
    throw new Error("Nedostaje matični broj primaoca.");
  }
  if (dispatch.shipmentMethod <= 3) {
    for (const [label, value] of [
      ["naziv prevoznika", dispatch.carrierName],
      ["PIB prevoznika", dispatch.carrierPib],
      ["adresa prevoznika", dispatch.carrierAddress],
      ["mesto prevoznika", dispatch.carrierCity],
      ["registarska oznaka vozila", dispatch.licensePlate],
    ]) {
      if (!value?.trim()) throw new Error(`Nedostaje ${label}.`);
    }
    if (
      (dispatch.carrierCountry ?? "RS").toUpperCase() === "RS" &&
      !dispatch.carrierRegistrationNumber?.trim()
    ) {
      throw new Error("Nedostaje matični broj prevoznika.");
    }
  } else {
    for (const [label, value] of [
      ["ime kurira", dispatch.courierFirstName],
      ["prezime kurira", dispatch.courierLastName],
      ["broj lične karte kurira", dispatch.courierIdNumber],
    ]) {
      if (!value?.trim()) throw new Error(`Nedostaje ${label}.`);
    }
  }
}

export async function postDispatchNotes(ids: string[], actorId: string) {
  if (!ids.length) throw new Error("Izaberite bar jednu otpremnicu.");
  const uniqueIds = Array.from(new Set(ids));
  const posted: string[] = [];
  for (const id of uniqueIds) {
    const result = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "DispatchNote" WHERE "id" = ${id} FOR UPDATE`,
        );
        const dispatch = await tx.dispatchNote.findUnique({
          where: { id },
          include: {
            items: { orderBy: { id: "asc" } },
            sourceWarehouse: true,
            destinationWarehouse: true,
          },
        });
        if (!dispatch) throw new Error(`Otpremnica ${id} ne postoji.`);
        if (dispatch.status === DocumentPostingStatus.POSTED) return null;
        if (dispatch.status !== DocumentPostingStatus.DRAFT) {
          throw new Error(`Otpremnica ${dispatch.number} nije nacrt.`);
        }
        if (!dispatch.items.length) {
          throw new Error(`Otpremnica ${dispatch.number} nema stavke.`);
        }
        assertDispatchTransportComplete(dispatch);
        if (
          dispatch.type === DispatchNoteType.INTERNAL &&
          !dispatch.destinationWarehouseId
        ) {
          throw new Error(
            `Interna otpremnica ${dispatch.number} nema odredišni magacin.`,
          );
        }

        for (const item of dispatch.items) {
          if (!item.productId) {
            throw new Error(`Stavka ${item.sku} nema vezan artikal.`);
          }
          if (dispatch.type === DispatchNoteType.INTERNAL) {
            await adjustInventory(tx, {
              idempotencyKey: `dispatch:${dispatch.id}:${item.id}:out`,
              dispatchNoteId: dispatch.id,
              warehouseId: dispatch.sourceWarehouseId,
              productId: item.productId,
              sku: item.sku,
              qtyDelta: -item.qty,
              kind: StockMovementKind.INTERNAL_TRANSFER_OUT,
              note: `Interna otpremnica ${dispatch.number}`,
              actorId,
            });
            await adjustInventory(tx, {
              idempotencyKey: `dispatch:${dispatch.id}:${item.id}:in`,
              dispatchNoteId: dispatch.id,
              warehouseId: dispatch.destinationWarehouseId!,
              productId: item.productId,
              sku: item.sku,
              qtyDelta: item.qty,
              kind: StockMovementKind.INTERNAL_TRANSFER_IN,
              note: `Interni prijem po otpremnici ${dispatch.number}`,
              actorId,
            });
            continue;
          }

          if (!item.orderItemId) {
            await adjustInventory(tx, {
              idempotencyKey: `dispatch:${dispatch.id}:${item.id}:out`,
              dispatchNoteId: dispatch.id,
              warehouseId: dispatch.sourceWarehouseId,
              productId: item.productId,
              sku: item.sku,
              qtyDelta: -item.qty,
              kind: StockMovementKind.DISPATCH,
              note: `Otpremnica ${dispatch.number}`,
              actorId,
            });
            continue;
          }

          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "OrderItem" WHERE "id" = ${item.orderItemId} FOR UPDATE`,
          );
          const orderItem = await tx.orderItem.findUnique({
            where: { id: item.orderItemId },
            select: {
              id: true,
              orderId: true,
              warehouseId: true,
              warehouseReservedQty: true,
              productId: true,
              order: { select: { number: true, status: true } },
            },
          });
          if (!orderItem || orderItem.productId !== item.productId) {
            throw new Error(`Izvorna stavka porudžbine za ${item.sku} ne postoji.`);
          }
          if (orderItem.warehouseId !== dispatch.sourceWarehouseId) {
            throw new Error(`Magacin rezervacije za ${item.sku} je promenjen.`);
          }
          if (
            orderItem.order.status === "ISPORUCENO" ||
            orderItem.order.status === "OTKAZANO" ||
            orderItem.order.status === "VRACENO"
          ) {
            throw new Error(
              `Porudžbina ${orderItem.order.number} više nije aktivna za otpremu.`,
            );
          }
          const reserved = Math.min(
            orderItem.warehouseReservedQty,
            item.qty,
          );
          const unreserved = item.qty - reserved;
          const updated = await tx.orderItem.updateMany({
            where: {
              id: orderItem.id,
              warehouseReservedQty: { gte: reserved },
            },
            data: {
              warehouseReservedQty: { decrement: reserved },
              warehouseDispatchedQty: { increment: item.qty },
            },
          });
          if (updated.count !== 1) {
            throw new Error(`Rezervacija za ${item.sku} je promenjena.`);
          }
          if (reserved > 0) {
            await recordReservedDispatch(tx, {
              dispatchNoteId: dispatch.id,
              warehouseId: dispatch.sourceWarehouseId,
              productId: item.productId,
              orderId: orderItem.orderId,
              orderItemId: orderItem.id,
              sku: item.sku,
              quantity: reserved,
              number: dispatch.number,
              actorId,
            });
          }
          if (unreserved > 0) {
            await adjustInventory(tx, {
              idempotencyKey: `dispatch:${dispatch.id}:${item.id}:unreserved`,
              dispatchNoteId: dispatch.id,
              warehouseId: dispatch.sourceWarehouseId,
              productId: item.productId,
              sku: item.sku,
              qtyDelta: -unreserved,
              kind: StockMovementKind.DISPATCH,
              orderId: orderItem.orderId,
              orderItemId: orderItem.id,
              note: `Otpremnica ${dispatch.number}`,
              actorId,
            });
          }
        }
        await tx.dispatchNote.update({
          where: { id: dispatch.id },
          data: {
            status: DocumentPostingStatus.POSTED,
            postedAt: new Date(),
            actorId,
          },
        });
        return dispatch.number;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    if (result) posted.push(result);
  }
  return posted;
}

function safeResponse(value: string) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Prisma.InputJsonValue;
  } catch {
    return { body: value.slice(0, 20_000) };
  }
}

function validationErrorMessages(value: unknown) {
  const results = Array.isArray(value) ? value : [value];
  const messages: string[] = [];
  for (const result of results) {
    if (!result || typeof result !== "object") continue;
    const record = result as Record<string, unknown>;
    if (record.isValid !== false && record.hasErrors !== true) continue;
    const messageCountBefore = messages.length;
    const resultMessages = Array.isArray(record.messages) ? record.messages : [];
    for (const item of resultMessages) {
      if (!item || typeof item !== "object") continue;
      const message = item as Record<string, unknown>;
      if (message.severity !== "Error") continue;
      const description =
        typeof message.description === "string" ? message.description : "";
      const code = typeof message.code === "string" ? message.code : "";
      messages.push([code, description].filter(Boolean).join(": "));
    }
    if (messages.length === messageCountBefore) {
      messages.push("XML dokument nije ispravan.");
    }
  }
  return messages;
}

async function validateDispatchUbl(
  config: ReturnType<typeof sefConfiguration>,
  ubl: string,
) {
  const form = new FormData();
  form.append(
    "File",
    new Blob([ubl], { type: "text/xml;charset=utf-8" }),
    "otpremnica.xml",
  );
  const response = await fetch(
    `${config.baseUrl}/public/xml-validator/validate-document`,
    {
      method: "POST",
      headers: { accept: "text/plain", "Api-key": config.apiKey },
      body: form,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    },
  );
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `eOtpremnica XML validacija je vratila HTTP ${response.status}${
        responseText ? `: ${responseText.slice(0, 500)}` : ""
      }`,
    );
  }
  let parsed: unknown = null;
  try {
    parsed = responseText ? JSON.parse(responseText) : null;
  } catch {
    throw new Error("eOtpremnica XML validator nije vratio ispravan JSON odgovor.");
  }
  if (!parsed || (typeof parsed !== "object" && !Array.isArray(parsed))) {
    throw new Error("eOtpremnica XML validator nije vratio rezultat validacije.");
  }
  const errors = validationErrorMessages(parsed);
  if (errors.length) {
    throw new Error(
      `eOtpremnica XML validacija nije prošla: ${errors.slice(0, 5).join(" | ")}`,
    );
  }
  return parsed as Prisma.InputJsonValue;
}

function sefConfiguration() {
  const baseUrl =
    envValue("EOTPREMNICA_BASE_URL") ??
    envValue("SEO_BASE_URL") ??
    envValue("SEF_BASE_URL");
  const apiKey =
    envValue("EOTPREMNICA_API_KEY") ??
    envValue("SEO_API_KEY") ??
    envValue("SEF_API_KEY");
  if (!baseUrl || !apiKey) {
    throw new Error(
      "eOtpremnica nije konfigurisana. Nedostaju EOTPREMNICA_BASE_URL i EOTPREMNICA_API_KEY.",
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

export async function sendDispatchNoteToSef(id: string) {
  const config = sefConfiguration();
  const dispatch = await db.dispatchNote.findUnique({
    where: { id },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      items: { orderBy: { id: "asc" } },
    },
  });
  if (!dispatch) throw new Error("Otpremnica ne postoji.");
  if (dispatch.status !== DocumentPostingStatus.POSTED) {
    throw new Error("Otpremnica mora prvo da bude proknjižena.");
  }
  if (dispatch.sefSentAt) return dispatch;
  if (!dispatch.items.length) throw new Error("Otpremnica nema stavke.");
  assertDispatchTransportComplete(dispatch);
  if (dateOnly(dispatch.issueDate) !== belgradeDate(new Date())) {
    throw new Error(
      "Datum izdavanja otpremnice mora biti današnji datum po vremenskoj zoni Srbije za slanje na eOtpremnicu.",
    );
  }

  const requestId = dispatch.sefRequestId ?? `dispatch-${dispatch.id}`;
  const ubl = buildDispatchNoteUbl({
    id: dispatch.id,
    number: dispatch.number,
    issueDate: dispatch.issueDate,
    internal: dispatch.type === DispatchNoteType.INTERNAL,
    notes: dispatch.notes,
    shipmentMethod: dispatch.shipmentMethod,
    actualDispatchAt: dispatch.actualDispatchAt!,
    plannedDeliveryAt: dispatch.plannedDeliveryAt!,
    sourceOrderNumbers: Array.from(
      new Set(
        dispatch.items
          .map((item) => item.sourceOrderNumber)
          .filter((value): value is string => Boolean(value)),
      ),
    ),
    issuer: {
      name: dispatch.issuerName,
      pib: dispatch.issuerPib,
      registrationNumber: dispatch.issuerRegistrationNumber,
      address: dispatch.issuerAddress,
      city: dispatch.issuerCity,
      postalCode: dispatch.issuerPostalCode,
      country: dispatch.issuerCountry,
      phone: dispatch.issuerPhone,
      email: dispatch.issuerEmail,
    },
    receiver: {
      name: dispatch.receiverName,
      pib: dispatch.receiverPib,
      registrationNumber: dispatch.receiverRegistrationNumber,
      address: dispatch.receiverAddress,
      city: dispatch.receiverCity,
      postalCode: dispatch.receiverPostalCode,
      country: dispatch.receiverCountry,
      phone: dispatch.receiverPhone,
      email: dispatch.receiverEmail,
    },
    sourceWarehouse: {
      code: dispatch.sourceWarehouse.code,
      name: dispatch.sourceWarehouse.name,
      address: dispatch.sourceWarehouse.address!,
      city: dispatch.sourceWarehouse.city!,
    },
    deliveryLocation:
      dispatch.type === DispatchNoteType.INTERNAL
        ? {
            code: dispatch.destinationWarehouseId ?? "INTERNAL",
            name: dispatch.destinationName ?? "Odredišni magacin",
            address: dispatch.destinationAddress ?? "",
            city: dispatch.destinationCity ?? "",
            country: "RS",
          }
        : null,
    carrier:
      dispatch.shipmentMethod <= 3
        ? {
            name: dispatch.carrierName!,
            pib: dispatch.carrierPib!,
            registrationNumber: dispatch.carrierRegistrationNumber!,
            address: dispatch.carrierAddress!,
            city: dispatch.carrierCity!,
            postalCode: dispatch.carrierPostalCode ?? "",
            country: dispatch.carrierCountry ?? "RS",
            phone: dispatch.carrierPhone,
            email: dispatch.carrierEmail,
          }
        : null,
    licensePlate: dispatch.licensePlate,
    courier:
      dispatch.shipmentMethod >= 4
        ? {
            firstName: dispatch.courierFirstName!,
            lastName: dispatch.courierLastName!,
            idNumber: dispatch.courierIdNumber!,
          }
        : null,
    items: dispatch.items.map((item) => ({
      sku: item.sku,
      name: item.shortName ?? item.name,
      description: item.shortDescription,
      sourceOrderNumber: item.sourceOrderNumber,
      qty: item.qty,
      attribute1: item.attribute1,
      attribute2: item.attribute2,
      attribute3: item.attribute3,
      attribute4: item.attribute4,
      color1: item.color1,
      color2: item.color2,
    })),
  });
  const staleSendingBefore = new Date(Date.now() - 5 * 60 * 1_000);
  const claimed = await db.dispatchNote.updateMany({
    where: {
      id,
      sefSentAt: null,
      OR: [
        { sefStatus: null },
        { sefStatus: { not: "SENDING" } },
        { sefStatus: "SENDING", updatedAt: { lt: staleSendingBefore } },
      ],
    },
    data: {
      sefRequestId: requestId,
      sefStatus: "SENDING",
      sefError: null,
    },
  });
  if (claimed.count !== 1) {
    const current = await db.dispatchNote.findUnique({ where: { id } });
    if (current?.sefSentAt) return current;
    throw new Error("Slanje ove otpremnice na SEF je već u toku.");
  }

  try {
    const validationData = await validateDispatchUbl(config, ubl);
    const form = new FormData();
    form.append("RequestId", requestId);
    form.append(
      "File",
      new Blob([ubl], { type: "text/xml;charset=utf-8" }),
      `otpremnica-${dispatch.number.replaceAll("/", "-")}.xml`,
    );
    const response = await fetch(`${config.baseUrl}/public/documents/requests`, {
      method: "POST",
      headers: {
        accept: "*/*",
        "Api-key": config.apiKey,
      },
      body: form,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const responseText = await response.text();
    const responseData = safeResponse(responseText);
    if (!response.ok) {
      throw new Error(
        `eOtpremnica je vratila HTTP ${response.status}${
          responseText ? `: ${responseText.slice(0, 500)}` : ""
        }`,
      );
    }
    return db.dispatchNote.update({
      where: { id },
      data: {
        sefStatus: "SUBMITTED",
        sefSentAt: new Date(),
        sefResponse: {
          validation: validationData,
          submission: responseData ?? null,
        },
        sefError: null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Slanje na SEF nije uspelo.";
    await db.dispatchNote.update({
      where: { id },
      data: {
        sefStatus: "ERROR",
        sefError: message,
      },
    });
    throw new Error(message);
  }
}

export async function getDispatchOrderLines(input: {
  receiverCustomerId: string;
  sourceWarehouseId: string;
  from: string;
  to: string;
  excludeDispatchId?: string | null;
}) {
  if (!input.receiverCustomerId) throw new Error("Izaberite firmu primaoca.");
  if (!input.sourceWarehouseId) throw new Error("Izaberite izvorni magacin.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.to)
  ) {
    throw new Error("Unesite početak i kraj perioda.");
  }
  if (input.from > input.to) {
    throw new Error("Kraj perioda mora biti nakon početka perioda.");
  }
  const from = new Date(`${input.from}T00:00:00.000Z`);
  const to = new Date(`${input.to}T23:59:59.999Z`);
  if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1_000) {
    throw new Error("Period za učitavanje može biti najviše 366 dana.");
  }
  return db.$transaction(async (tx) => {
    const items = await tx.orderItem.findMany({
      where: {
        warehouseId: input.sourceWarehouseId,
        productId: { not: null },
        order: {
          customerId: input.receiverCustomerId,
          channel: { in: IMPORT_CHANNELS },
          status: { notIn: ["ISPORUCENO", "OTKAZANO", "VRACENO"] },
          createdAt: { gte: from, lte: to },
        },
      },
      orderBy: [{ order: { createdAt: "asc" } }, { id: "asc" }],
      include: {
        order: { select: { id: true, number: true, channel: true } },
        product: { include: productInclude },
      },
    });
    const allocations = await allocatedOrderQuantities(
      tx,
      items.map((item) => item.id),
      input.excludeDispatchId,
    );
    return items.flatMap((item): DispatchNoteFormLine[] => {
      if (!item.product) return [];
      const available =
        originalWarehouseAllocation(item) - (allocations.get(item.id) ?? 0);
      if (available <= 0) return [];
      const metadata = productMetadata(item.product);
      return [
        {
          id: undefined,
          orderItemId: item.id,
          sourceOrderNumber: item.order.number,
          productId: item.product.id,
          sku: item.sku,
          subgroup: item.subgroupName ?? metadata.subgroup,
          collection: item.collectionName ?? metadata.collection,
          shortDescription:
            item.shortDescriptionSnapshot ?? metadata.shortDescription,
          shortName: item.shortNameSnapshot ?? metadata.shortName,
          attribute1: item.attribute1 ?? metadata.attribute1,
          attribute2: item.attribute2 ?? metadata.attribute2,
          attribute3: item.attribute3 ?? metadata.attribute3,
          attribute4: item.attribute4 ?? metadata.attribute4,
          color1: item.color1 ?? metadata.color1,
          color2: item.color2 ?? metadata.color2,
          unitPriceGross: decimal(item.unitPriceSale),
          priceSource: `Porudžbina ${item.order.number}`,
          qty: available,
          maxQty: available,
        },
      ];
    });
  });
}

export async function getDispatchNoteDetail(
  id: string,
): Promise<DispatchNoteDetail | null> {
  const note = await db.dispatchNote.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { id: "asc" },
        include: {
          product: { include: productInclude },
          orderItem: {
            select: {
              qty: true,
              warehouseReservedQty: true,
              warehouseDispatchedQty: true,
              supplierReservedQty: true,
            },
          },
        },
      },
    },
  });
  if (!note) return null;
  const allocations = await db.dispatchNoteItem.groupBy({
    by: ["orderItemId"],
    where: {
      orderItemId: {
        in: note.items
          .map((item) => item.orderItemId)
          .filter((value): value is string => Boolean(value)),
      },
      dispatchNote: {
        status: { not: DocumentPostingStatus.CANCELLED },
        id: { not: note.id },
      },
    },
    _sum: { qty: true },
  });
  const allocatedByOrderItem = new Map(
    allocations
      .filter(
        (row): row is typeof row & { orderItemId: string } =>
          Boolean(row.orderItemId),
      )
      .map((row) => [row.orderItemId, row._sum.qty ?? 0]),
  );
  const lines = note.items.map((item): DispatchNoteFormLine => {
    const product = item.product;
    const metadata = product
      ? productMetadata(product)
      : {
          subgroup: "",
          collection: "",
          shortDescription: "",
          shortName: item.name,
          attribute1: "",
          attribute2: "",
          attribute3: "",
          attribute4: "",
          color1: "",
          color2: "",
        };
    const maxQty =
      item.orderItem && item.orderItemId
        ? originalWarehouseAllocation(item.orderItem) -
          (allocatedByOrderItem.get(item.orderItemId) ?? 0)
        : null;
    return {
      id: item.id,
      orderItemId: item.orderItemId,
      sourceOrderNumber: item.sourceOrderNumber ?? "",
      productId: item.productId ?? "",
      sku: item.sku,
      subgroup: item.subgroup ?? metadata.subgroup,
      collection: item.collection ?? metadata.collection,
      shortDescription: item.shortDescription ?? metadata.shortDescription,
      shortName: item.shortName ?? metadata.shortName,
      attribute1: item.attribute1 ?? metadata.attribute1,
      attribute2: item.attribute2 ?? metadata.attribute2,
      attribute3: item.attribute3 ?? metadata.attribute3,
      attribute4: item.attribute4 ?? metadata.attribute4,
      color1: item.color1 ?? metadata.color1,
      color2: item.color2 ?? metadata.color2,
      unitPriceGross: decimal(item.unitPriceGross),
      priceSource: item.orderItemId
        ? `Porudžbina ${item.sourceOrderNumber ?? ""}`.trim()
        : "Sačuvana automatska cena",
      qty: item.qty,
      maxQty: maxQty === null ? null : Math.max(maxQty, item.qty),
    };
  });
  const editable =
    note.status === DocumentPostingStatus.DRAFT && !note.sefSentAt;
  const sefSendingIsStale =
    note.sefStatus === "SENDING" &&
    note.updatedAt < new Date(Date.now() - 5 * 60 * 1_000);
  return {
    id: note.id,
    number: note.number,
    type: note.type,
    status: note.status,
    issueDate: dateOnly(note.issueDate),
    issuerCustomerId: note.issuerCustomerId ?? "",
    receiverCustomerId: note.receiverCustomerId ?? "",
    sourceWarehouseId: note.sourceWarehouseId,
    destinationWarehouseId: note.destinationWarehouseId ?? "",
    showPrices: note.showPrices,
    currency: note.currency,
    notes: note.notes ?? "",
    importFrom: dateOnly(note.importFrom),
    importTo: dateOnly(note.importTo),
    shipmentMethod: note.shipmentMethod,
    carrierCustomerId: note.carrierCustomerId ?? "",
    licensePlate: note.licensePlate ?? "",
    courierFirstName: note.courierFirstName ?? "",
    courierLastName: note.courierLastName ?? "",
    courierIdNumber: note.courierIdNumber ?? "",
    actualDispatchAt: dateTime(note.actualDispatchAt),
    plannedDeliveryAt: dateTime(note.plannedDeliveryAt),
    totalNet: decimal(note.totalNet),
    totalVat: decimal(note.totalVat),
    totalGross: decimal(note.totalGross),
    postedAt: dateTime(note.postedAt),
    sefSentAt: dateTime(note.sefSentAt),
    sefStatus: note.sefStatus ?? "",
    sefError: note.sefError ?? "",
    canEdit: editable,
    canDelete: editable,
    canPost: note.status === DocumentPostingStatus.DRAFT,
    canSendToSef:
      note.status === DocumentPostingStatus.POSTED &&
      !note.sefSentAt &&
      (note.sefStatus !== "SENDING" || sefSendingIsStale),
    issuer: {
      id: note.issuerCustomerId ?? "",
      label: note.issuerName,
      companyName: note.issuerName,
      pib: note.issuerPib,
      registrationNumber: note.issuerRegistrationNumber,
      address: note.issuerAddress,
      city: note.issuerCity,
      postalCode: note.issuerPostalCode,
      country: note.issuerCountry,
      phone: note.issuerPhone ?? "",
      email: note.issuerEmail ?? "",
    },
    receiver: {
      id: note.receiverCustomerId ?? "",
      label: note.receiverName,
      companyName: note.receiverName,
      pib: note.receiverPib,
      registrationNumber: note.receiverRegistrationNumber,
      address: note.receiverAddress,
      city: note.receiverCity,
      postalCode: note.receiverPostalCode,
      country: note.receiverCountry,
      phone: note.receiverPhone ?? "",
      email: note.receiverEmail ?? "",
    },
    carrier: note.carrierName
      ? {
          id: note.carrierCustomerId ?? "",
          label: note.carrierName,
          companyName: note.carrierName,
          pib: note.carrierPib ?? "",
          registrationNumber: note.carrierRegistrationNumber ?? "",
          address: note.carrierAddress ?? "",
          city: note.carrierCity ?? "",
          postalCode: note.carrierPostalCode ?? "",
          country: note.carrierCountry ?? "RS",
          phone: note.carrierPhone ?? "",
          email: note.carrierEmail ?? "",
        }
      : null,
    lines,
  };
}
