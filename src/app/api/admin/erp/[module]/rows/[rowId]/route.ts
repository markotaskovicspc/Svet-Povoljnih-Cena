import { NextResponse } from "next/server";
import {
  ArticleStatus,
  AllocationBasis,
  CampaignStatus,
  CogsStatus,
  CustomerGender,
  DiscountTarget,
  ErpCurrency,
  InboundInvoiceStatus,
  InboundInvoiceType,
  LandingPageStatus,
  Prisma,
  PriceListKind,
  ProductLookupKind,
  ReclamationDecision,
  ReclamationRequest,
  ReclamationResolution,
  ReclamationStatus,
  ReclamationType,
} from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit, requireAdminAction } from "@/lib/admin";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import {
  composedArticleName,
  syncArticleLookupAssignments,
} from "@/lib/admin/article-master.server";
import { sanitizeRichText } from "@/lib/rich-text";
import {
  syncAllProductChannelAvailability,
  syncProductChannelAvailability,
} from "@/lib/channel-availability.server";
import { SUPPLIER_PARITY_OPTIONS } from "@/lib/supplier-master";
import { updatePurchasePriceCell } from "@/lib/admin/purchase-price.server";

type CellValue = string | number | boolean | null;
type PersistedCellResult = {
  value: CellValue;
  refreshRow?: boolean;
};

const currencyFromUi: Record<string, ErpCurrency> = {
  RSD: "RSD",
  EUR: "EUR",
  "€": "EUR",
  USD: "USD",
  "$": "USD",
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
  const { module, rowId } = await ctx.params;
  const admin = await requireAdminAction(allowedRolesForErpModule(module));
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

    return NextResponse.json({
      ok: true,
      value: result.value,
      refreshRow: result.refreshRow ?? false,
    });
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
): Promise<PersistedCellResult | null> {
  switch (module) {
    case "artikli":
    case "mp-cene":
      return persistProductCell(rowId, columnKey, value);
    case "dobavljaci":
      return persistSupplierCell(rowId, columnKey, value);
    case "nabavne-cene":
      return persistPurchasePriceCell(rowId, columnKey, value);
    case "porudzbenice":
    case "porudzbenice-po-artiklima":
      return null;
    case "ulazne-fakture":
      return persistInboundInvoiceCell(rowId, columnKey, value);
    case "sifarnici-artikala":
      return persistLookupCell(rowId, columnKey, value);
    case "cenovnici":
      return persistPriceListCell(rowId, columnKey, value);
    case "akcijske-cene":
      return persistActionPriceCell(rowId, columnKey, value);
    case "loyalty":
      return persistLoyaltyCell(rowId, columnKey, value);
    case "linearne-promocije":
      return persistLinearPromotionCell(rowId, columnKey, value);
    case "magacini":
      return persistWarehouseCell(rowId, columnKey, value);
    case "kupci":
      return persistCustomerCell(rowId, columnKey, value);
    case "partner-klijenti":
      return persistPartnerClientCell(rowId, columnKey, value);
    case "landing-strane":
      return persistLandingPageCell(rowId, columnKey, value);
    case "landing-sekcije":
      return persistLandingSectionCell(rowId, columnKey, value);
    case "mobilni-tabovi":
      return persistMobileTabCell(rowId, columnKey, value);
    case "newsletter-kampanje":
      return persistNewsletterCell(rowId, columnKey, value);
    case "reklamacije-dnevnik":
      return persistReclamationCell(rowId, columnKey, value);
    case "admin-podesavanja":
      return persistAdminSettingCell(rowId, columnKey, value);
    default:
      return null;
  }
}

async function persistProductCell(rowId: string, columnKey: string, value: CellValue) {
  if (columnKey === "status") {
    const status = asString(value).toUpperCase();
    const articleStatuses: Record<string, ArticleStatus> = {
      SP: "SP",
      IT: "IT",
      DTZ: "DTZ",
      DOB: "DOB",
      ARH: "ARH",
      UZ: "UZ",
    };
    const articleStatus = articleStatuses[status];
    if (!articleStatus) throw new Error("Nepoznat status artikla.");
    const data =
      status === "ARH"
        ? { articleStatus, isActive: false, isDtz: false, isLimited: false }
        : status === "DTZ"
          ? { articleStatus, isActive: true, isDtz: true, isLimited: false }
          : status === "IT"
            ? { articleStatus, isActive: true, isDtz: false, isLimited: true }
            : status === "ARH" || status === "UZ"
              ? { articleStatus, isActive: false, isDtz: false, isLimited: false }
              : { articleStatus, isActive: true, isDtz: false, isLimited: false };
    await db.product.update({ where: { id: rowId }, data });
    return { value: status };
  }

  const data: Prisma.ProductUncheckedUpdateInput = {};
  switch (columnKey) {
    case "shortName":
    case "name":
      data.shortName = requiredString(value, "Naziv je obavezan.");
      break;
    case "shortDescription":
      data.shortDescription = optionalString(value);
      break;
    case "siteDescription":
      data.description = sanitizeRichText(optionalString(value) ?? "");
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
    case "reservedStock":
    case "stockDc":
    case "availableTotal":
    case "availableDc":
      throw new Error(
        "Ova kolona je izračunata. Izmenite stanje na kartonu artikla ili po magacinu.",
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
    case "weightKg":
      data.weightKg = nullableDecimal(value, "Težina mora biti broj.");
      break;
    case "grossWeightKg":
      data.grossWeightKg = nullableDecimal(value, "Bruto težina mora biti broj.");
      break;
    case "packQty":
      data.packQty = nullableInt(value, "Broj komada u pakovanju mora biti ceo broj.");
      break;
    case "packWidthCm":
      data.packWidthCm = nullableDecimal(value, "Širina pakovanja mora biti broj.");
      break;
    case "packDepthCm":
      data.packDepthCm = nullableDecimal(value, "Dubina pakovanja mora biti broj.");
      break;
    case "packHeightCm":
      data.packHeightCm = nullableDecimal(value, "Visina pakovanja mora biti broj.");
      break;
    case "packGrossWeightKg":
      data.packGrossWeightKg = nullableDecimal(value, "Bruto težina pakovanja mora biti broj.");
      break;
    case "supplierName":
      data.supplierProductName = optionalString(value);
      break;
    case "barcode":
      data.barcode = optionalString(value);
      break;
    case "hsCode":
      data.hsCode = optionalString(value);
      break;
    case "moq":
      data.moq = nullableInt(value, "MOQ mora biti ceo broj.");
      break;
    case "ananasBrokerage":
      data.ananasBrokeragePct = nullableDecimal(value, "Procenat mora biti broj.");
      break;
    case "ananasStorage":
      data.ananasStoragePct = nullableDecimal(value, "Procenat mora biti broj.");
      break;
    case "ananasDelivery":
      data.ananasDeliveryPct = nullableDecimal(value, "Procenat mora biti broj.");
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
  await db.$transaction(async (tx) => {
    await tx.product.update({ where: { id: rowId }, data });
    if (["shortName", "name", "shortDescription"].includes(columnKey)) {
      const product = await tx.product.findUniqueOrThrow({
        where: { id: rowId },
        select: {
          shortName: true,
          shortDescription: true,
          collection: { select: { name: true } },
        },
      });
      await tx.product.update({
        where: { id: rowId },
        data: {
          name: composedArticleName({
            collectionName: product.collection?.name,
            shortDescription: product.shortDescription,
            shortName: product.shortName,
          }),
        },
      });
    }
    if (
      ["attribute1", "attribute2", "attribute3", "attribute4", "color1", "color2"].includes(
        columnKey,
      )
    ) {
      const product = await tx.product.findUniqueOrThrow({
        where: { id: rowId },
        select: {
          attribute1: true,
          attribute2: true,
          attribute3: true,
          attribute4: true,
          colorPrimary: true,
          colorSecondary: true,
          lookupAssignments: {
            where: { lookupValue: { kind: { in: ["BENEFIT", "CERTIFICATE"] } } },
            select: { lookupValue: { select: { kind: true, value: true } } },
          },
        },
      });
      await syncArticleLookupAssignments(tx, rowId, {
        attributes: [
          product.attribute1,
          product.attribute2,
          product.attribute3,
          product.attribute4,
        ],
        colors: [product.colorPrimary, product.colorSecondary],
        benefits: product.lookupAssignments
          .filter((row) => row.lookupValue.kind === "BENEFIT")
          .map((row) => row.lookupValue.value),
        certificates: product.lookupAssignments
          .filter((row) => row.lookupValue.kind === "CERTIFICATE")
          .map((row) => row.lookupValue.value),
      });
    }
    if (["webCheck", "wholesaleCheck", "exportCheck"].includes(columnKey)) {
      await syncProductChannelAvailability(tx, rowId);
    }
  });
  return { value };
}

async function persistSupplierCell(rowId: string, columnKey: string, value: CellValue) {
  if (/^loading[1-3]$/.test(columnKey)) {
    const position = Number(columnKey.slice(-1));
    const name = optionalString(value);
    if (!name) {
      await db.supplierLoadingLocation.deleteMany({
        where: { supplierId: rowId, position },
      });
    } else {
      const offeredLocation = await db.supplierLoadingLocation.findFirst({
        where: { name },
        select: { id: true },
      });
      if (!offeredLocation) {
        throw new Error("Izaberite mesto utovara iz ponuđenih vrednosti.");
      }
      await db.supplierLoadingLocation.upsert({
        where: { supplierId_position: { supplierId: rowId, position } },
        create: {
          supplierId: rowId,
          position,
          name,
        },
        update: { name },
      });
    }
    return { value: name };
  }
  if (columnKey === "defaultPriceList") {
    const code = optionalString(value);
    const priceList = code
      ? await db.priceList.findUnique({ where: { code }, select: { id: true } })
      : null;
    if (code && !priceList) throw new Error(`Cenovnik ${code} ne postoji.`);
    await db.supplier.update({
      where: { id: rowId },
      data: { defaultPriceListId: priceList?.id ?? null },
    });
    return { value: code };
  }
  const data: Prisma.SupplierUncheckedUpdateInput = {};
  switch (columnKey) {
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
    case "parity": {
      const parity = optionalString(value);
      if (
        parity &&
        !SUPPLIER_PARITY_OPTIONS.some((option) => option === parity)
      ) {
        throw new Error("Izaberite paritet iz ponuđene liste.");
      }
      data.parity = parity;
      break;
    }
    case "paymentTerms":
      data.paymentTerms = optionalString(value);
      break;
    case "deliveryDays":
      data.deliveryDays = nullableInt(value, "Rok isporuke mora biti ceo broj.");
      if (typeof data.deliveryDays === "number" && data.deliveryDays < 0) {
        throw new Error("Rok isporuke ne može biti negativan.");
      }
      break;
    case "transitDays":
      data.transitDays = nullableInt(value, "Tranzitno vreme mora biti ceo broj.");
      if (typeof data.transitDays === "number" && data.transitDays < 0) {
        throw new Error("Tranzitno vreme ne može biti negativno.");
      }
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
  return updatePurchasePriceCell(rowId, columnKey, value);
}

async function persistInboundInvoiceCell(rowId: string, columnKey: string, value: CellValue) {
  const current = await db.inboundInvoice.findUnique({
    where: { id: rowId },
    select: { lockedAt: true },
  });
  if (current?.lockedAt) throw new Error("Zaključana faktura se ne može menjati.");
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
    case "exchangeRate":
      data.exchangeRate = decimalValue(value, "Kurs mora biti broj.");
      break;
    case "netValue": {
      const amount = decimalValue(value, "Neto vrednost mora biti broj.");
      data.netValue = amount;
      data.value = amount;
      break;
    }
    case "vatValue":
      data.vatValue = decimalValue(value, "PDV vrednost mora biti broj.");
      break;
    case "grossValue":
      data.grossValue = decimalValue(value, "Bruto vrednost mora biti broj.");
      break;
    case "allocationBasis":
      data.allocationBasis = enumFromMap(
        AllocationBasis,
        value,
        "Nepoznat način raspodele.",
      );
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

async function persistLookupCell(rowId: string, columnKey: string, value: CellValue) {
  const data: Prisma.ProductLookupValueUncheckedUpdateInput = {};
  switch (columnKey) {
    case "kind":
      data.kind = enumFromMap(ProductLookupKind, value, "Nepoznata vrsta šifarnika.");
      break;
    case "value":
      data.value = requiredString(value, "Vrednost je obavezna.");
      break;
    case "slug":
      data.slug = requiredString(value, "Slug je obavezan.");
      break;
    case "active":
      data.active = Boolean(value);
      break;
    default:
      return null;
  }
  await db.productLookupValue.update({ where: { id: rowId }, data });
  return { value };
}

async function persistPriceListCell(rowId: string, columnKey: string, value: CellValue) {
  const data: Prisma.PriceListUncheckedUpdateInput = {};
  switch (columnKey) {
    case "code":
      data.code = requiredString(value, "Šifra cenovnika je obavezna.");
      break;
    case "name":
      data.name = requiredString(value, "Naziv cenovnika je obavezan.");
      break;
    case "kind":
      data.kind = enumFromMap(PriceListKind, value, "Nepoznata vrsta cenovnika.");
      break;
    case "currency":
      data.currency = enumFromMap(currencyFromUi, value, "Nepoznata valuta.");
      break;
    case "validFrom":
      data.validFrom = value === null ? null : dateValue(value, "Datum početka nije ispravan.");
      break;
    case "validTo":
      data.validTo = value === null ? null : dateValue(value, "Datum završetka nije ispravan.");
      break;
    case "active":
      data.active = Boolean(value);
      break;
    default:
      return null;
  }
  await db.priceList.update({ where: { id: rowId }, data });
  return { value };
}

async function persistActionPriceCell(rowId: string, columnKey: string, value: CellValue) {
  const [actionId, productId] = rowId.split(":");
  if (!actionId || !productId) throw new Error("Veza akcije i artikla nije ispravna.");
  if (columnKey === "salePrice") {
    await db.actionProduct.update({
      where: { actionId_productId: { actionId, productId } },
      data: { salePrice: decimalValue(value, "Akcijska cena mora biti broj.") },
    });
    return { value };
  }
  const data: Prisma.ActionUncheckedUpdateInput = {};
  switch (columnKey) {
    case "priority":
      data.priority = intValue(value, "Prioritet mora biti ceo broj.");
      break;
    case "startsAt":
      data.startsAt = dateValue(value, "Datum početka nije ispravan.");
      break;
    case "endsAt":
      data.endsAt = dateValue(value, "Datum završetka nije ispravan.");
      break;
    default:
      return null;
  }
  await db.action.update({ where: { id: actionId }, data });
  return { value };
}

async function persistLoyaltyCell(rowId: string, columnKey: string, value: CellValue) {
  const data: Prisma.LoyaltyRuleUncheckedUpdateInput = {};
  switch (columnKey) {
    case "name":
      data.name = requiredString(value, "Naziv pravila je obavezan.");
      break;
    case "discountPct":
      data.discountPct = decimalValue(value, "Popust mora biti broj.");
      break;
    case "priority":
      data.priority = intValue(value, "Prioritet mora biti ceo broj.");
      break;
    case "startsAt":
      data.startsAt = value === null ? null : dateValue(value, "Datum početka nije ispravan.");
      break;
    case "endsAt":
      data.endsAt = value === null ? null : dateValue(value, "Datum završetka nije ispravan.");
      break;
    case "active":
      data.active = Boolean(value);
      break;
    default:
      return null;
  }
  await db.loyaltyRule.update({ where: { id: rowId }, data });
  return { value };
}

async function persistLinearPromotionCell(
  rowId: string,
  columnKey: string,
  value: CellValue,
) {
  const data: Prisma.LinearPromotionUncheckedUpdateInput = {};
  switch (columnKey) {
    case "name":
      data.name = requiredString(value, "Naziv promocije je obavezan.");
      break;
    case "target":
      data.target = enumFromMap(DiscountTarget, value, "Nepoznat obuhvat promocije.");
      break;
    case "discountPct":
      data.discountPct = decimalValue(value, "Popust mora biti broj.");
      break;
    case "priority":
      data.priority = intValue(value, "Prioritet mora biti ceo broj.");
      break;
    case "startsAt":
      data.startsAt = dateValue(value, "Datum početka nije ispravan.");
      break;
    case "endsAt":
      data.endsAt = dateValue(value, "Datum završetka nije ispravan.");
      break;
    case "active":
      data.active = Boolean(value);
      break;
    default:
      return null;
  }
  await db.linearPromotion.update({ where: { id: rowId }, data });
  return { value };
}

async function persistWarehouseCell(rowId: string, columnKey: string, value: CellValue) {
  const data: Prisma.WarehouseUncheckedUpdateInput = {};
  switch (columnKey) {
    case "code":
      data.code = requiredString(value, "Šifra magacina je obavezna.");
      break;
    case "name":
      data.name = requiredString(value, "Naziv magacina je obavezan.");
      break;
    case "address":
      data.address = optionalString(value);
      break;
    case "city":
      data.city = optionalString(value);
      break;
    case "email": {
      const email = optionalString(value);
      if (email && !email.includes("@")) throw new Error("E-mail mora da sadrži @.");
      data.email = email;
      break;
    }
    case "phone":
      data.phone = optionalString(value);
      break;
    case "active":
      data.active = Boolean(value);
      break;
    case "isDefault": {
      const isDefault = Boolean(value);
      await db.$transaction(async (tx) => {
        if (isDefault) {
          await tx.warehouse.updateMany({ where: { id: { not: rowId } }, data: { isDefault: false } });
        }
        await tx.warehouse.update({ where: { id: rowId }, data: { isDefault } });
        await syncAllProductChannelAvailability(tx);
      });
      return { value: isDefault };
    }
    default:
      return null;
  }
  await db.warehouse.update({ where: { id: rowId }, data });
  return { value };
}

async function persistCustomerCell(rowId: string, columnKey: string, value: CellValue) {
  const data: Prisma.CustomerUncheckedUpdateInput = {};
  switch (columnKey) {
    case "email": {
      const email = optionalString(value);
      if (email && !email.includes("@")) throw new Error("E-mail mora da sadrži @.");
      data.email = email;
      break;
    }
    case "phone":
      data.phone = optionalString(value);
      break;
    case "address":
      data.address = optionalString(value);
      break;
    case "city":
      data.city = optionalString(value);
      break;
    case "pib":
      data.pib = optionalString(value);
      break;
    case "gender":
      data.gender = enumFromMap(CustomerGender, value, "Nepoznata vrednost pola.");
      break;
    default:
      return null;
  }
  await db.customer.update({ where: { id: rowId }, data });
  return { value };
}

async function persistPartnerClientCell(
  rowId: string,
  columnKey: string,
  value: CellValue,
) {
  const data: Prisma.PartnerApiClientUncheckedUpdateInput = {};
  switch (columnKey) {
    case "name":
      data.name = requiredString(value, "Naziv partnera je obavezan.");
      break;
    case "scopes": {
      const scopes = asString(value)
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean);
      const allowed = new Set(["inventory:read", "reservations:write"]);
      if (scopes.some((scope) => !allowed.has(scope))) {
        throw new Error("Dozvoljeni scope-ovi su inventory:read i reservations:write.");
      }
      data.scopes = scopes;
      break;
    }
    case "rateLimit": {
      const rateLimit = intValue(value, "Rate limit mora biti ceo broj.");
      if (rateLimit < 1 || rateLimit > 10_000) {
        throw new Error("Rate limit mora biti između 1 i 10000.");
      }
      data.rateLimit = rateLimit;
      break;
    }
    case "enabled":
      data.enabled = Boolean(value);
      break;
    default:
      return null;
  }
  await db.partnerApiClient.update({ where: { id: rowId }, data });
  return { value };
}

async function persistLandingPageCell(rowId: string, columnKey: string, value: CellValue) {
  const data: Prisma.LandingPageUncheckedUpdateInput = {};
  switch (columnKey) {
    case "slug":
      data.slug = requiredString(value, "Slug je obavezan.");
      break;
    case "title":
      data.title = requiredString(value, "Naslov je obavezan.");
      break;
    case "lead":
      data.lead = optionalString(value);
      break;
    case "heroImageUrl":
      data.heroImageUrl = optionalString(value);
      break;
    case "seoTitle":
      data.seoTitle = optionalString(value);
      break;
    case "seoDescription":
      data.seoDescription = optionalString(value);
      break;
    case "status": {
      const status = enumFromMap(LandingPageStatus, value, "Nepoznat status landing strane.");
      data.status = status;
      if (status === LandingPageStatus.PUBLISHED) data.publishedAt = new Date();
      break;
    }
    case "startsAt":
      data.startsAt = value === null ? null : dateValue(value, "Datum početka nije ispravan.");
      break;
    case "endsAt":
      data.endsAt = value === null ? null : dateValue(value, "Datum završetka nije ispravan.");
      break;
    default:
      return null;
  }
  await db.landingPage.update({ where: { id: rowId }, data });
  return { value };
}

async function persistLandingSectionCell(
  rowId: string,
  columnKey: string,
  value: CellValue,
) {
  const data: Prisma.LandingPageSectionUncheckedUpdateInput = {};
  switch (columnKey) {
    case "position":
      data.position = intValue(value, "Pozicija mora biti ceo broj.");
      break;
    case "title":
      data.title = optionalString(value);
      break;
    case "body":
      data.body = optionalString(value);
      break;
    case "imageUrl":
      data.imageUrl = optionalString(value);
      break;
    case "productSkus":
      data.productSkus = asString(value)
        .split(",")
        .map((sku) => sku.trim())
        .filter(Boolean);
      break;
    default:
      return null;
  }
  await db.landingPageSection.update({ where: { id: rowId }, data });
  return { value };
}

async function persistMobileTabCell(rowId: string, columnKey: string, value: CellValue) {
  const data: Prisma.MobileTabUncheckedUpdateInput = {};
  switch (columnKey) {
    case "position": {
      const position = intValue(value, "Pozicija mora biti ceo broj od 1 do 4.");
      if (position < 1 || position > 4) throw new Error("Pozicija mora biti od 1 do 4.");
      data.position = position;
      break;
    }
    case "label":
      data.label = requiredString(value, "Naziv taba je obavezan.");
      break;
    case "icon":
      data.icon = optionalString(value);
      break;
    case "enabled":
      data.enabled = Boolean(value);
      break;
    default:
      return null;
  }
  await db.mobileTab.update({ where: { id: rowId }, data });
  return { value };
}

async function persistNewsletterCell(rowId: string, columnKey: string, value: CellValue) {
  const data: Prisma.NewsletterCampaignUncheckedUpdateInput = {};
  switch (columnKey) {
    case "title":
      data.title = requiredString(value, "Naziv kampanje je obavezan.");
      break;
    case "subject":
      data.subject = requiredString(value, "Naslov poruke je obavezan.");
      break;
    case "body":
      data.body = requiredString(value, "Sadržaj kampanje je obavezan.");
      break;
    case "status":
      data.status = enumFromMap(CampaignStatus, value, "Nepoznat status kampanje.");
      break;
    case "scheduledAt":
      data.scheduledAt = value === null ? null : dateValue(value, "Datum slanja nije ispravan.");
      break;
    default:
      return null;
  }
  await db.newsletterCampaign.update({ where: { id: rowId }, data });
  return { value };
}

async function persistReclamationCell(rowId: string, columnKey: string, value: CellValue) {
  if (columnKey === "status") {
    const status = enumFromMap(ReclamationStatus, value, "Nepoznat status reklamacije.");
    await db.$transaction([
      db.reclamation.update({
        where: { id: rowId },
        data: {
          status,
          resolvedAt:
            status === ReclamationStatus.RESENO || status === ReclamationStatus.ODBIJENO
              ? new Date()
              : null,
        },
      }),
      db.reclamationStatusEvent.create({ data: { reclamationId: rowId, status } }),
    ]);
    return { value: status };
  }
  const data: Prisma.ReclamationUncheckedUpdateInput = {};
  switch (columnKey) {
    case "type":
      data.type = value === null ? null : enumFromMap(ReclamationType, value, "Nepoznat tip.");
      break;
    case "request":
      data.request =
        value === null ? null : enumFromMap(ReclamationRequest, value, "Nepoznat zahtev.");
      break;
    case "decision":
      data.decision = enumFromMap(ReclamationDecision, value, "Nepoznata odluka.");
      break;
    case "resolution":
      data.resolution =
        value === null
          ? null
          : enumFromMap(ReclamationResolution, value, "Nepoznat način rešavanja.");
      break;
    case "respondedAt":
      data.respondedAt =
        value === null ? null : dateValue(value, "Datum odgovora nije ispravan.");
      break;
    case "resolvedAt":
      data.resolvedAt =
        value === null ? null : dateValue(value, "Datum rešavanja nije ispravan.");
      break;
    default:
      return null;
  }
  await db.reclamation.update({ where: { id: rowId }, data });
  return { value };
}

async function persistAdminSettingCell(rowId: string, columnKey: string, value: CellValue) {
  if (columnKey !== "value") return null;
  let parsed: Prisma.InputJsonValue;
  try {
    parsed = JSON.parse(requiredString(value, "JSON vrednost je obavezna.")) as Prisma.InputJsonValue;
  } catch {
    throw new Error("Vrednost podešavanja mora biti ispravan JSON.");
  }
  await db.adminSetting.update({ where: { key: rowId }, data: { value: parsed } });
  return { value: JSON.stringify(parsed) };
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
