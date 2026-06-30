import { NextResponse } from "next/server";
import {
  CogsStatus,
  ErpCurrency,
  InboundInvoiceStatus,
  InboundInvoiceType,
  Prisma,
  PurchaseOrderStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit, requireAdminAction } from "@/lib/admin";

type CellValue = string | number | boolean | null;

const currencyFromUi: Record<string, ErpCurrency> = {
  RSD: "RSD",
  EUR: "EUR",
  "€": "EUR",
  USD: "USD",
  "$": "USD",
};

const purchaseOrderStatusFromUi: Record<string, PurchaseOrderStatus> = {
  "U obradi": "DRAFT",
  Poslata: "SENT",
  "Potvrđena": "CONFIRMED",
  Primljena: "RECEIVED",
  Otkazana: "CANCELLED",
  DRAFT: "DRAFT",
  SENT: "SENT",
  CONFIRMED: "CONFIRMED",
  RECEIVED: "RECEIVED",
  CANCELLED: "CANCELLED",
};

const inboundStatusFromUi: Record<string, InboundInvoiceStatus> = {
  "U pripremi": "DRAFT",
  Primljena: "RECEIVED",
  "Proknjižena": "POSTED",
  Storno: "CANCELLED",
  DRAFT: "DRAFT",
  RECEIVED: "RECEIVED",
  POSTED: "POSTED",
  CANCELLED: "CANCELLED",
};

const cogsStatusFromUi: Record<string, CogsStatus> = {
  "Čeka razradu": "PENDING",
  "Ceka razradu": "PENDING",
  "Razrađen": "CALCULATED",
  Razradjen: "CALCULATED",
  "Zaključan": "LOCKED",
  Zakljucan: "LOCKED",
  PENDING: "PENDING",
  CALCULATED: "CALCULATED",
  LOCKED: "LOCKED",
};

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ module: string; rowId: string }> },
) {
  const admin = await requireAdminAction(["OPS"]);
  const { module, rowId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as
    | { columnKey?: unknown; value?: unknown }
    | null;
  const columnKey = typeof body?.columnKey === "string" ? body.columnKey : "";
  const value = normalizeJsonValue(body?.value);

  if (!columnKey) {
    return NextResponse.json({ ok: false, error: "Nedostaje kolona." }, { status: 400 });
  }

  try {
    const result = await persistErpCell(module, rowId, columnKey, value);
    if (!result) {
      return NextResponse.json(
        { ok: false, error: "Ovo ERP polje još nema direktno mapiranje na bazu." },
        { status: 422 },
      );
    }

    await logAudit({
      actorId: admin.id,
      action: "erp.cell.update",
      entity: `erp:${module}`,
      entityId: rowId,
      diff: { columnKey, value },
    });

    return NextResponse.json({ ok: true, value: result.value });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ERP izmena nije snimljena.";
    await logAudit({
      actorId: admin.id,
      action: "erp.cell.update.error",
      entity: `erp:${module}`,
      entityId: rowId,
      diff: { columnKey, value, error: message },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

async function persistErpCell(
  module: string,
  rowId: string,
  columnKey: string,
  value: CellValue,
): Promise<{ value: CellValue } | null> {
  switch (module) {
    case "artikli":
    case "mp-cene":
      return persistProductCell(rowId, columnKey, value);
    case "dobavljaci":
      return persistSupplierCell(rowId, columnKey, value);
    case "nabavne-cene":
      return persistPurchasePriceCell(rowId, columnKey, value);
    case "porudzbenice":
      return persistPurchaseOrderCell(rowId, columnKey, value);
    case "porudzbenice-po-artiklima":
      return persistPurchaseOrderItemCell(rowId, columnKey, value);
    case "ulazne-fakture":
      return persistInboundInvoiceCell(rowId, columnKey, value);
    default:
      return null;
  }
}

async function persistProductCell(rowId: string, columnKey: string, value: CellValue) {
  if (columnKey === "status") {
    const status = asString(value).toUpperCase();
    const data =
      status === "ARH"
        ? { isActive: false, isDtz: false, isLimited: false }
        : status === "DTZ"
          ? { isActive: true, isDtz: true, isLimited: false }
          : status === "IT"
            ? { isActive: true, isDtz: false, isLimited: true }
            : status === "SP"
              ? { isActive: true, isDtz: false, isLimited: false }
              : null;
    if (!data) throw new Error("Nepoznat status artikla.");
    await db.product.update({ where: { id: rowId }, data });
    return { value: status };
  }

  const data: Prisma.ProductUncheckedUpdateInput = {};
  switch (columnKey) {
    case "shortName":
    case "name":
      data.name = requiredString(value, "Naziv je obavezan.");
      break;
    case "shortDescription":
      data.shortDescription = optionalString(value);
      break;
    case "siteDescription":
      data.description = optionalString(value) ?? "";
      break;
    case "attribute1":
      data.attribute1 = optionalString(value);
      break;
    case "attribute2":
      data.attribute2 = optionalString(value);
      break;
    case "attribute3":
      data.attribute3 = optionalString(value);
      break;
    case "attribute4":
      data.attribute4 = optionalString(value);
      break;
    case "color1":
      data.colorPrimary = optionalString(value);
      break;
    case "color2":
      data.colorSecondary = optionalString(value);
      break;
    case "cogs":
      data.cogs = value === null ? null : decimalValue(value, "COGS mora biti broj.");
      break;
    case "customsRate":
      data.customsRate =
        value === null ? null : decimalValue(value, "Carinska stopa mora biti broj.");
      break;
    case "stockTotal":
      data.stock = intValue(value, "Zalihe moraju biti ceo broj.");
      break;
    case "stockDc":
    case "availableTotal":
    case "availableDc":
      throw new Error(
        "Ova kolona je izračunata. Izmenite „Ukupne zalihe“ ili stanje po magacinu.",
      );
    case "incomingTotal":
    case "incomingAvailable":
      data.incomingStock = intValue(value, "Količina u dolasku mora biti ceo broj.");
      break;
    case "widthCm":
      data.widthCm = decimalValue(value, "Širina mora biti broj.");
      break;
    case "heightCm":
      data.heightCm = decimalValue(value, "Visina mora biti broj.");
      break;
    case "depthCm":
      data.depthCm = decimalValue(value, "Dubina mora biti broj.");
      break;
    case "barcode":
      data.barcode = optionalString(value);
      break;
    case "webAuto":
    case "wholesaleAuto":
    case "exportAuto":
      throw new Error(
        "Auto status se izračunava iz zaliha. Menjajte ručni „check“ status.",
      );
    case "webCheck":
      data.availableWebManual = Boolean(value);
      break;
    case "wholesaleCheck":
      data.availableWholesaleManual = Boolean(value);
      break;
    case "exportCheck":
      data.availableExportManual = Boolean(value);
      break;
    case "deliveryDays":
      data.deliveryDaysMax = intValue(value, "Rok isporuke mora biti ceo broj.");
      break;
    case "calcRetailPrice":
    case "currentMpc":
      data.salePrice = decimalValue(value, "Cena mora biti broj.");
      break;
    case "fullPrice":
    case "calcMpc":
      data.fullPrice = decimalValue(value, "Cena mora biti broj.");
      break;
    case "bmPct":
      data.discountPct = value === null ? null : intValue(value, "BM% mora biti ceo broj.");
      break;
    default:
      return null;
  }
  await db.product.update({ where: { id: rowId }, data });
  return { value };
}

async function persistSupplierCell(rowId: string, columnKey: string, value: CellValue) {
  const data: Prisma.SupplierUncheckedUpdateInput = {};
  switch (columnKey) {
    case "code":
      data.code = optionalString(value);
      break;
    case "name":
      data.name = requiredString(value, "Naziv dobavljača je obavezan.");
      break;
    case "address":
      data.address = optionalString(value);
      break;
    case "city":
      data.city = optionalString(value);
      break;
    case "country":
      data.country = optionalString(value);
      break;
    case "email": {
      const email = optionalString(value);
      if (email && !email.includes("@")) throw new Error("Kontakt mail mora da sadrži @.");
      data.email = email;
      break;
    }
    case "phone":
      data.phone = optionalString(value);
      break;
    case "currency":
      data.currency = enumFromMap(currencyFromUi, value, "Nepoznata valuta.");
      break;
    case "parity":
      data.parity = optionalString(value);
      break;
    case "paymentTerms":
      data.paymentTerms = optionalString(value);
      break;
    case "deliveryDays":
      data.deliveryDays = nullableInt(value, "Rok isporuke mora biti ceo broj.");
      break;
    case "transitDays":
      data.transitDays = nullableInt(value, "Tranzitno vreme mora biti ceo broj.");
      break;
    case "bank":
      data.bank = optionalString(value);
      break;
    case "swift":
      data.swift = optionalString(value);
      break;
    case "iban":
      data.iban = optionalString(value);
      break;
    default:
      return null;
  }
  await db.supplier.update({ where: { id: rowId }, data });
  return { value };
}

async function persistPurchasePriceCell(rowId: string, columnKey: string, value: CellValue) {
  const data: Prisma.PurchasePriceUncheckedUpdateInput = {};
  switch (columnKey) {
    case "sku":
      data.sku = requiredString(value, "SKU je obavezan.");
      break;
    case "name":
      data.name = optionalString(value);
      break;
    case "attributes":
      data.attributes = optionalString(value);
      break;
    case "pattern":
      data.pattern = optionalString(value);
      break;
    case "purchasePrice":
      data.price = decimalValue(value, "Nabavna cena mora biti broj.");
      break;
    case "currency":
      data.currency = enumFromMap(currencyFromUi, value, "Nepoznata valuta.");
      break;
    case "parity":
      data.parity = optionalString(value);
      break;
    case "validFrom":
      data.validFrom = dateValue(value, "Datum važenja je neispravan.");
      break;
    case "validTo":
      data.validTo = value === null ? null : dateValue(value, "Datum važenja je neispravan.");
      break;
    default:
      return null;
  }
  await db.purchasePrice.update({ where: { id: rowId }, data });
  return { value };
}

async function persistPurchaseOrderCell(rowId: string, columnKey: string, value: CellValue) {
  const data: Prisma.PurchaseOrderUncheckedUpdateInput = {};
  switch (columnKey) {
    case "number":
      data.number = requiredString(value, "Broj porudžbenice je obavezan.");
      break;
    case "status":
      data.status = enumFromMap(purchaseOrderStatusFromUi, value, "Nepoznat status porudžbenice.");
      break;
    case "orderDate":
      data.orderDate = value === null ? null : dateValue(value, "Datum porudžbine je neispravan.");
      break;
    case "loadingDate":
      data.loadingDate = value === null ? null : dateValue(value, "Datum utovara je neispravan.");
      break;
    case "deliveryDate":
      data.deliveryDate = value === null ? null : dateValue(value, "Datum isporuke je neispravan.");
      break;
    case "totalVolume":
      data.totalVolume = nullableDecimal(value, "Zapremina mora biti broj.");
      break;
    case "totalWeight":
      data.totalWeight = nullableDecimal(value, "Težina mora biti broj.");
      break;
    case "totalPrice":
      data.totalPrice = decimalValue(value, "Ukupna cena mora biti broj.");
      break;
    case "currency":
      data.currency = enumFromMap(currencyFromUi, value, "Nepoznata valuta.");
      break;
    case "transportType":
      data.transportType = optionalString(value);
      break;
    case "parity":
      data.parity = optionalString(value);
      break;
    case "bmPct":
      data.bmPct = nullableDecimal(value, "BM% mora biti broj.");
      break;
    default:
      return null;
  }
  await db.purchaseOrder.update({ where: { id: rowId }, data });
  return { value };
}

async function persistPurchaseOrderItemCell(rowId: string, columnKey: string, value: CellValue) {
  const data: Prisma.PurchaseOrderItemUncheckedUpdateInput = {};
  switch (columnKey) {
    case "sku":
      data.sku = requiredString(value, "SKU je obavezan.");
      break;
    case "name":
      data.name = requiredString(value, "Naziv je obavezan.");
      break;
    case "attributes":
      data.attributes = optionalString(value);
      break;
    case "pattern":
      data.pattern = optionalString(value);
      break;
    case "purchasePrice":
      data.purchasePrice = decimalValue(value, "Nabavna cena mora biti broj.");
      break;
    case "currency":
      data.currency = enumFromMap(currencyFromUi, value, "Nepoznata valuta.");
      break;
    case "parity":
      data.parity = optionalString(value);
      break;
    case "moq":
      data.moq = nullableInt(value, "MOQ mora biti ceo broj.");
      break;
    case "packQty":
      data.packQty = nullableInt(value, "Kom/pak mora biti ceo broj.");
      break;
    case "qty":
      data.qty = intValue(value, "Količina mora biti ceo broj.");
      break;
    case "receivedQty":
      data.receivedQty = intValue(value, "Primljena količina mora biti ceo broj.");
      break;
    case "totalVolume":
      data.totalVolume = nullableDecimal(value, "Zapremina mora biti broj.");
      break;
    case "totalWeight":
      data.totalWeight = nullableDecimal(value, "Težina mora biti broj.");
      break;
    case "customsRate":
      data.customsRate = nullableDecimal(value, "Carinska stopa mora biti broj.");
      break;
    case "calcRetailPrice":
      data.calcRetailPrice = nullableDecimal(value, "Kalkulativna MPC mora biti broj.");
      break;
    case "bmPct":
      data.bmPct = nullableDecimal(value, "BM% mora biti broj.");
      break;
    default:
      return null;
  }
  await db.purchaseOrderItem.update({ where: { id: rowId }, data });
  return { value };
}

async function persistInboundInvoiceCell(rowId: string, columnKey: string, value: CellValue) {
  const data: Prisma.InboundInvoiceUncheckedUpdateInput = {};
  switch (columnKey) {
    case "number":
      data.number = requiredString(value, "Broj fakture je obavezan.");
      break;
    case "type":
      data.type = enumFromMap(InboundInvoiceType, value, "Nepoznat tip fakture.");
      break;
    case "status":
      data.status = enumFromMap(inboundStatusFromUi, value, "Nepoznat status fakture.");
      break;
    case "invoiceDate":
      data.invoiceDate = value === null ? null : dateValue(value, "Datum fakture je neispravan.");
      break;
    case "currency":
      data.currency = enumFromMap(currencyFromUi, value, "Nepoznata valuta.");
      break;
    case "value":
      data.value = decimalValue(value, "Vrednost mora biti broj.");
      break;
    case "cogsStatus":
      data.cogsStatus = enumFromMap(cogsStatusFromUi, value, "Nepoznat COGS status.");
      break;
    default:
      return null;
  }
  await db.inboundInvoice.update({ where: { id: rowId }, data });
  return { value };
}

function normalizeJsonValue(value: unknown): CellValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function asString(value: CellValue) {
  return value === null ? "" : String(value).trim();
}

function optionalString(value: CellValue) {
  const trimmed = asString(value);
  return trimmed ? trimmed : null;
}

function requiredString(value: CellValue, message: string) {
  const trimmed = asString(value);
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function numberValue(value: CellValue, message: string) {
  const parsed = typeof value === "number" ? value : Number(asString(value).replace(",", "."));
  if (!Number.isFinite(parsed)) throw new Error(message);
  return parsed;
}

function intValue(value: CellValue, message: string) {
  const parsed = numberValue(value, message);
  if (!Number.isInteger(parsed)) throw new Error(message);
  return parsed;
}

function nullableInt(value: CellValue, message: string) {
  return value === null ? null : intValue(value, message);
}

function decimalValue(value: CellValue, message: string) {
  return numberValue(value, message);
}

function nullableDecimal(value: CellValue, message: string) {
  return value === null ? null : decimalValue(value, message);
}

function dateValue(value: CellValue, message: string) {
  const raw = asString(value);
  const date = new Date(`${raw}T00:00:00.000`);
  if (!raw || Number.isNaN(date.getTime())) throw new Error(message);
  return date;
}

function enumFromMap<T extends string>(
  map: Record<string, T>,
  value: CellValue,
  message: string,
) {
  const key = asString(value);
  const mapped = map[key];
  if (!mapped) throw new Error(message);
  return mapped;
}
