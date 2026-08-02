import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit, requireAdminAction } from "@/lib/admin";
import {
  createPurchaseOrder,
  postPurchaseOrder,
  receivePurchaseOrder,
  sendPurchaseOrder,
} from "@/lib/admin/po";
import {
  cancelInboundInvoice,
  createInboundInvoice,
  lockInboundInvoice,
} from "@/lib/admin/inbound-invoice.server";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import { articleSlug } from "@/lib/article-master";
import { nextArticleSku } from "@/lib/admin/article-master.server";
import { normalizeArticleSku } from "@/lib/article-sku";
import {
  articleCopySelect,
  buildCopiedArticleData,
  copyArticleRelations,
} from "@/lib/admin/article-copy.server";
import { createSupplierWithAutomaticCode } from "@/lib/admin/supplier-master.server";
import {
  createPurchasePrice,
  type PurchasePriceCommandInput,
} from "@/lib/admin/purchase-price.server";
import { deleteManualSalesOrders } from "@/lib/admin/sales-order.server";
import { createWarehouseWithAutomaticCode } from "@/lib/admin/warehouse-master.server";
import {
  createPickupBatch,
  deletePickupBatches,
  postPickupBatches,
} from "@/lib/admin/pickup-batch.server";
import {
  createStocktakeDispatch,
  postStocktakeDispatches,
} from "@/lib/admin/stocktake-dispatch.server";
import {
  customerGenderLabel,
  normalizeCustomerMasterDetails,
} from "@/lib/admin/customer-master";
import {
  deleteDispatchNotes,
  postDispatchNotes,
  sendDispatchNoteToSef,
} from "@/lib/admin/dispatch-note.server";

type CommandResult = { message: string; createdId?: string; redirect?: string };

export async function POST(
  req: Request,
  ctx: { params: Promise<{ module: string }> },
) {
  const { module } = await ctx.params;
  const admin = await requireAdminAction(allowedRolesForErpModule(module));
  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; ids?: unknown; input?: unknown }
    | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id): id is string => typeof id === "string")
    : [];
  const input = isCommandInput(body?.input) ? body.input : {};

  if (!action) {
    return NextResponse.json({ ok: false, error: "Nedostaje komanda." }, { status: 400 });
  }

  try {
    const result = await runCommand(module, action, ids, admin.id, input);
    if (module === "landing-strane" || module === "landing-sekcije") {
      revalidateTag("storefront-landing-pages", { expire: 0 });
      revalidateTag("storefront-home", { expire: 0 });
    }
    if (module === "heroji-meseca") {
      revalidateTag("storefront-home", { expire: 0 });
      revalidatePath("/");
    }
    await logAudit({
      actorId: admin.id,
      action: `erp.command.${action}`,
      entity: `erp:${module}`,
      entityId: result.createdId ?? (ids.join(",") || null),
      diff: { action, ids, input },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Komanda nije izvršena.";
    await logAudit({
      actorId: admin.id,
      action: `erp.command.${action}.error`,
      entity: `erp:${module}`,
      entityId: ids.join(",") || null,
      diff: { action, ids, input, error: message },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

async function runCommand(
  module: string,
  action: string,
  ids: string[],
  actorId: string,
  input: PurchasePriceCommandInput,
): Promise<CommandResult> {
  switch (action) {
    case "row.delete":
      return deleteRows(module, ids);
    case "article.create":
      return createArticle(input);
    case "lookup.create":
      return createLookupValue();
    case "supplier.create":
      return createSupplier();
    case "purchase-price.create":
      if (module !== "nabavne-cene") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      return createPurchasePriceEntry(input);
    case "price-list.create":
      return createPriceList();
    case "loyalty.create":
      return createLoyaltyRule();
    case "linear-promotion.create":
      return createLinearPromotion();
    case "warehouse.create":
      if (module !== "magacini") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      return createWarehouse(input);
    case "stocktake.create": {
      if (module !== "popisi") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      const dispatch = await createStocktakeDispatch();
      return {
        message: `Popis ${dispatch.number} je kreiran.`,
        createdId: dispatch.id,
        redirect: `/admin/erp/popisi/${dispatch.id}?mode=edit`,
      };
    }
    case "stocktake.post": {
      if (module !== "popisi") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      const posted = await postStocktakeDispatches(ids, actorId);
      return { message: `Proknjiženo popisa: ${posted}.` };
    }
    case "sales-order.delete": {
      if (module !== "prodajni-nalozi") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      const deleted = await deleteManualSalesOrders(ids, actorId);
      return {
        message: `Obrisano porudžbina: ${deleted.length}.`,
      };
    }
    case "dispatch.delete": {
      if (module !== "otpremnice") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      const deleted = await deleteDispatchNotes(ids);
      return { message: `Obrisano otpremnica: ${deleted.length}.` };
    }
    case "dispatch.post": {
      if (module !== "otpremnice") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      const posted = await postDispatchNotes(ids, actorId);
      return { message: `Proknjiženo otpremnica: ${posted.length}.` };
    }
    case "dispatch.sef-send": {
      if (module !== "otpremnice") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      requireIds(ids);
      let sent = 0;
      for (const id of Array.from(new Set(ids))) {
        const before = await db.dispatchNote.findUnique({
          where: { id },
          select: { sefSentAt: true },
        });
        await sendDispatchNoteToSef(id);
        if (!before?.sefSentAt) sent += 1;
      }
      return { message: `Poslato na SEF: ${sent}.` };
    }
    case "pickup.create":
      if (module !== "preuzimanja") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      return createPickupBatchCommand();
    case "pickup.delete":
      if (module !== "preuzimanja") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      return deletePickupBatchCommand(ids, actorId);
    case "pickup.post":
      if (module !== "preuzimanja") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      return postPickupBatchCommand(ids, actorId);
    case "customer.create":
      if (module !== "kupci") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      return createCustomer(input);
    case "partner-client.create":
      return createPartnerClient();
    case "landing.create":
      return createLandingPage();
    case "landing-section.create":
      return createLandingSections(ids);
    case "newsletter.create":
      return createNewsletterCampaign();
    case "po-items.validate-packs":
      if (module !== "porudzbenice-po-artiklima") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      return validatePurchaseOrderPacks(ids);
    case "po.create":
      if (module !== "porudzbenice") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      return createPurchaseOrderCommand();
    case "po.send":
      if (module !== "porudzbenice") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      return sendPurchaseOrders(ids, actorId);
    case "po.post":
      if (module !== "porudzbenice") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      return postPurchaseOrders(ids, actorId);
    case "po.receive":
      if (module !== "porudzbenice") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      return receivePurchaseOrders(ids, actorId);
    case "invoice.create":
      if (module !== "ulazne-fakture") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      return createInboundInvoiceCommand();
    case "invoice.lock":
    case "invoice.post":
      if (module !== "ulazne-fakture") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      return lockInboundInvoices(ids);
    case "invoice.cancel":
      if (module !== "ulazne-fakture") {
        throw new Error("Komanda nije dostupna u ovom ERP modulu.");
      }
      return cancelInboundInvoices(ids);
    case "mp.proposal":
    case "mp.publish":
      throw new Error(
        "Legacy objava MP cena je isključena. Koristite važeću stavku RETAIL cenovnika.",
      );
    default:
      throw new Error("Ova komanda još nije povezana.");
  }
}

function isCommandInput(value: unknown): value is PurchasePriceCommandInput {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireIds(ids: string[]) {
  if (ids.length === 0) throw new Error("Izaberite bar jedan red.");
}

async function deleteRows(module: string, ids: string[]): Promise<CommandResult> {
  requireIds(ids);
  const where = { id: { in: ids } };
  let count = 0;
  switch (module) {
    case "artikli":
      count = (
        await db.product.updateMany({
          where,
          data: {
            articleStatus: "ARH",
            isActive: false,
            deletedAt: new Date(),
          },
        })
      ).count;
      break;
    case "dobavljaci":
      count = (await db.supplier.deleteMany({ where })).count;
      break;
    case "nabavne-cene":
      count = (await db.purchasePrice.deleteMany({ where })).count;
      break;
    case "ulazne-fakture":
      count = (await db.inboundInvoice.deleteMany({ where })).count;
      break;
    case "landing-strane":
      count = (await db.landingPage.deleteMany({ where })).count;
      break;
    case "landing-sekcije":
      count = (await db.landingPageSection.deleteMany({ where })).count;
      break;
    case "heroji-meseca":
      count = (await db.heroOfMonth.deleteMany({ where })).count;
      revalidatePath("/heroji-meseca");
      break;
    case "newsletter-kampanje":
      count = (
        await db.newsletterCampaign.deleteMany({
          where: { id: { in: ids }, status: "DRAFT" },
        })
      ).count;
      break;
    default:
      throw new Error("Brisanje nije podržano za ovaj modul.");
  }
  return { message: `Obrisano: ${count}.` };
}

async function createArticle(input: PurchasePriceCommandInput): Promise<CommandResult> {
  const requestedSourceSku =
    typeof input.sourceSku === "string" && input.sourceSku.trim()
      ? normalizeArticleSku(input.sourceSku)
      : null;
  const product = await db.$transaction(async (tx) => {
    const sku = await nextArticleSku(tx);
    const slug = `${articleSlug(sku)}-${randomBytes(3).toString("hex")}`;
    if (!requestedSourceSku) {
      return tx.product.create({
        data: {
          sku,
          slug,
          name: "Novi artikal",
          shortName: "Novi artikal",
          description: "Dopuniti opis za sajt.",
          fullPrice: 0,
          articleStatus: "UZ",
          isActive: false,
        },
      });
    }

    const source = await tx.product.findFirst({
      where: {
        sku: { equals: requestedSourceSku, mode: "insensitive" },
        deletedAt: null,
      },
      select: articleCopySelect,
    });
    if (!source) {
      throw new Error(
        `Artikal sa šifrom ${requestedSourceSku} ne postoji u bazi artikala.`,
      );
    }

    const copied = await tx.product.create({
      data: buildCopiedArticleData(source, { sku, slug }),
    });
    await copyArticleRelations(tx, copied.id, source);
    return copied;
  });
  return {
    message: requestedSourceSku
      ? `Artikal ${product.sku} je kreiran kao neobjavljena kopija artikla ${requestedSourceSku}, sa novom šifrom i bez slika i operativnih podataka izvornog artikla.`
      : `Artikal ${product.sku} je kreiran neobjavljen. Dopunite obavezna polja.`,
    createdId: product.id,
    redirect: `/admin/erp/artikli/${product.id}`,
  };
}

async function createLookupValue(): Promise<CommandResult> {
  const count = await db.productLookupValue.count();
  const lookup = await withUniqueRetry(() =>
    db.productLookupValue.create({
      data: {
        kind: "ATTRIBUTE",
        value: `Nova vrednost ${count + 1}`,
        slug: `nova-vrednost-${count + 1}`,
        active: false,
      },
    }),
  );
  return {
    message: "Vrednost šifarnika je kreirana isključena.",
    createdId: lookup.id,
  };
}

/** Insert a record, retrying once on a unique-constraint clash to dodge number races. */
async function withUniqueRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return fn();
    }
    throw err;
  }
}

async function createSupplier(): Promise<CommandResult> {
  const supplier = await createSupplierWithAutomaticCode((code) => ({
    name: `Novi dobavljač ${code}`,
  }));
  return {
    message: `Dobavljač ${supplier.code} je kreiran. Popunite podatke u redu.`,
    createdId: supplier.id,
  };
}

async function createPurchasePriceEntry(
  input: PurchasePriceCommandInput,
): Promise<CommandResult> {
  const purchasePrice = await createPurchasePrice(input);
  return {
    message: `Nabavna cena za artikal ${purchasePrice.sku} je kreirana.`,
    createdId: purchasePrice.id,
  };
}

async function createPriceList(): Promise<CommandResult> {
  const year = new Date().getFullYear();
  const priceList = await withUniqueRetry(async () => {
    const count = await db.priceList.count();
    const serial = String(count + 1).padStart(3, "0");
    return db.priceList.create({
      data: {
        code: `MP-${year}-${serial}`,
        name: `Novi MP cenovnik ${serial}`,
        kind: "RETAIL",
        validFrom: new Date(),
      },
    });
  });
  return { message: `Cenovnik ${priceList.code} je kreiran.`, createdId: priceList.id };
}

async function createLoyaltyRule(): Promise<CommandResult> {
  const count = await db.loyaltyRule.count();
  const startsAt = new Date();
  const endsAt = new Date(startsAt);
  endsAt.setDate(endsAt.getDate() + 30);
  const rule = await db.loyaltyRule.create({
    data: {
      name: `Novo loyalty pravilo ${count + 1}`,
      discountPct: 5,
      scope: "ALL_PRODUCTS",
      startsAt,
      endsAt,
      active: false,
    },
  });
  return { message: "Loyalty pravilo je kreirano isključeno.", createdId: rule.id };
}

async function createLinearPromotion(): Promise<CommandResult> {
  const count = await db.linearPromotion.count();
  const startsAt = new Date();
  const endsAt = new Date(startsAt);
  endsAt.setDate(endsAt.getDate() + 30);
  const promotion = await db.linearPromotion.create({
    data: {
      name: `Nova linearna promocija ${count + 1}`,
      discountPct: 5,
      target: "ALL",
      startsAt,
      endsAt,
      active: false,
    },
  });
  return {
    message: "Linearna promocija je kreirana isključena.",
    createdId: promotion.id,
  };
}

async function createWarehouse(
  input: Record<string, unknown>,
): Promise<CommandResult> {
  const warehouse = await createWarehouseWithAutomaticCode(input);
  return {
    message: `Magacin „${warehouse.name}” je kreiran.`,
    createdId: warehouse.id,
  };
}

async function createPickupBatchCommand(): Promise<CommandResult> {
  const batch = await createPickupBatch();
  return {
    message: `Nalog ${batch.number} je kreiran.`,
    createdId: batch.id,
    redirect: `/admin/erp/preuzimanja/${batch.id}?mode=edit`,
  };
}

async function deletePickupBatchCommand(
  ids: string[],
  actorId: string,
): Promise<CommandResult> {
  const result = await deletePickupBatches(ids, actorId);
  return { message: `Obrisano naloga: ${result.deletedCount}.` };
}

async function postPickupBatchCommand(
  ids: string[],
  actorId: string,
): Promise<CommandResult> {
  const result = await postPickupBatches(ids, actorId);
  return {
    message: `Obrađeno naloga: ${result.posted}; kreirano ili poslato pošiljki: ${result.shipmentCount}.`,
  };
}

async function createCustomer(
  input: Record<string, unknown>,
): Promise<CommandResult> {
  const details = normalizeCustomerMasterDetails(input);
  const customer = await db.customer.create({
    data: {
      firstName: details.firstName || null,
      lastName: details.lastName,
      companyName: details.companyName,
      pib: details.pib,
      registrationNumber: details.registrationNumber,
      address: details.address,
      city: details.city,
      postalCode: details.postalCode,
      country: details.country,
      phone: details.phone,
      email: details.email,
      gender: details.gender,
    },
  });
  return {
    message:
      details.customerType === "COMPANY"
        ? `Firma „${details.fullName}” je kreirana i dostupna za VP/INO naloge i otpremnice.`
        : `Kupac „${details.fullName}” je kreiran. Pol: ${customerGenderLabel(details.gender)}.`,
    createdId: customer.id,
  };
}

async function createPartnerClient(): Promise<CommandResult> {
  const token = `spc_partner_${randomBytes(24).toString("base64url")}`;
  const prefix = token.slice(0, 18);
  const count = await db.partnerApiClient.count();
  const client = await db.partnerApiClient.create({
    data: {
      name: `Novi partner ${count + 1}`,
      keyPrefix: prefix,
      keyHash: createHash("sha256").update(token).digest("hex"),
      scopes: ["inventory:read"],
      enabled: false,
    },
  });
  return {
    message: `Ključ se prikazuje samo sada: ${token}. Klijent je kreiran isključen.`,
    createdId: client.id,
  };
}

async function createLandingPage(): Promise<CommandResult> {
  const landing = await withUniqueRetry(async () => {
    const count = await db.landingPage.count();
    const serial = count + 1;
    return db.landingPage.create({
      data: {
        slug: `nova-landing-strana-${serial}`,
        title: `Nova landing strana ${serial}`,
      },
    });
  });
  revalidatePath("/admin/erp/landing-strane");
  return { message: "Landing strana je kreirana kao nacrt.", createdId: landing.id };
}

async function createLandingSections(ids: string[]): Promise<CommandResult> {
  requireIds(ids);
  let created = 0;
  for (const landingPageId of ids) {
    const page = await db.landingPage.findUnique({
      where: { id: landingPageId },
      select: {
        id: true,
        title: true,
        sections: {
          take: 1,
          orderBy: { position: "desc" },
          select: { position: true },
        },
      },
    });
    if (!page) throw new Error(`Landing strana ${landingPageId} ne postoji.`);
    const position = (page.sections[0]?.position ?? 0) + 1;
    await db.landingPageSection.create({
      data: {
        landingPageId: page.id,
        position,
        title: `Nova sekcija ${position}`,
        productSkus: [],
      },
    });
    created += 1;
  }
  return {
    message: `Kreirano landing sekcija: ${created}.`,
    redirect: "/admin/erp/landing-sekcije",
  };
}

async function createNewsletterCampaign(): Promise<CommandResult> {
  const count = await db.newsletterCampaign.count();
  const campaign = await db.newsletterCampaign.create({
    data: {
      title: `Nova kampanja ${count + 1}`,
      subject: `Nova kampanja ${count + 1}`,
      body: "Dopunite sadržaj kampanje pre zakazivanja.",
    },
  });
  return { message: "Newsletter kampanja je kreirana kao nacrt.", createdId: campaign.id };
}

async function validatePurchaseOrderPacks(ids: string[]): Promise<CommandResult> {
  requireIds(ids);
  const items = await db.purchaseOrderItem.findMany({
    where: { id: { in: ids } },
    select: { sku: true, qty: true, packQty: true },
  });
  const invalid = items.filter(
    (item) => item.packQty && item.packQty > 0 && item.qty % item.packQty !== 0,
  );
  if (invalid.length) {
    throw new Error(
      `Količina nije deljiva pakovanjem: ${invalid
        .map((item) => `${item.sku} (${item.qty}/${item.packQty})`)
        .join(", ")}.`,
    );
  }
  return { message: `Pakovanja su ispravna za ${items.length} stavki.` };
}

async function createPurchaseOrderCommand(): Promise<CommandResult> {
  const order = await createPurchaseOrder();
  return {
    message: `Porudžbenica ${order.number} je kreirana (status: U obradi).`,
    createdId: order.id,
    redirect: `/admin/erp/porudzbenice/${order.id}`,
  };
}

async function postPurchaseOrders(
  ids: string[],
  actorId: string,
): Promise<CommandResult> {
  requireIds(ids);
  for (const id of ids) {
    await postPurchaseOrder(id, actorId);
  }
  return { message: `Proknjiženo i zaključano porudžbenica: ${ids.length}.` };
}

async function createInboundInvoiceCommand(): Promise<CommandResult> {
  const invoice = await createInboundInvoice();
  return {
    message: `Faktura ${invoice.number} je kreirana.`,
    createdId: invoice.id,
    redirect: `/admin/erp/ulazne-fakture/${invoice.id}?mode=edit`,
  };
}

async function sendPurchaseOrders(ids: string[], actorId: string): Promise<CommandResult> {
  requireIds(ids);
  let count = 0;
  for (const id of ids) {
    await sendPurchaseOrder(id, actorId);
    count += 1;
  }
  return { message: `Poslato dobavljaču: ${count}.` };
}

async function receivePurchaseOrders(ids: string[], actorId: string): Promise<CommandResult> {
  requireIds(ids);
  let received = 0;
  let postedLines = 0;
  let warehouseName: string | null = null;
  for (const id of ids) {
    const result = await receivePurchaseOrder(id, actorId);
    if (result.received) received += 1;
    postedLines += result.postedLines;
    warehouseName = result.warehouseName;
  }
  const warn = warehouseName ? "" : " Napomena: nije pronađen magacin, lager nije ažuriran.";
  return {
    message: `Primljeno porudžbenica: ${received}. Ažurirano lager stavki: ${postedLines}.${warn}`,
  };
}

async function lockInboundInvoices(ids: string[]): Promise<CommandResult> {
  requireIds(ids);
  for (const id of ids) await lockInboundInvoice(id);
  return { message: `Zaključano faktura: ${ids.length}.` };
}

async function cancelInboundInvoices(ids: string[]): Promise<CommandResult> {
  requireIds(ids);
  for (const id of ids) await cancelInboundInvoice(id);
  return { message: `Stornirano faktura: ${ids.length}. COGS i dolaz su preračunati.` };
}
