import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createHash, randomBytes } from "node:crypto";
import {
  CogsStatus,
  DispatchNoteType,
  DocumentPostingStatus,
  InboundInvoiceStatus,
  InboundInvoiceType,
  PaymentMethod,
  Prisma,
  PurchaseOrderStatus,
  RetailPriceProposalStatus,
  SalesChannel,
  ShippingMethod,
  StockMovementKind,
} from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit, requireAdminAction } from "@/lib/admin";
import {
  allocateLandedCost,
  receivePurchaseOrder,
  sendPurchaseOrder,
} from "@/lib/admin/po";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import { adjustInventory } from "@/lib/inventory";
import { nextArticleSku } from "@/lib/admin/article-master.server";
import { articleSlug } from "@/lib/article-master";

type CommandResult = { message: string; createdId?: string; redirect?: string };

export async function POST(
  req: Request,
  ctx: { params: Promise<{ module: string }> },
) {
  const { module } = await ctx.params;
  const admin = await requireAdminAction(allowedRolesForErpModule(module));
  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; ids?: unknown }
    | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id): id is string => typeof id === "string")
    : [];

  if (!action) {
    return NextResponse.json({ ok: false, error: "Nedostaje komanda." }, { status: 400 });
  }

  try {
    const result = await runCommand(module, action, ids, admin.id);
    await logAudit({
      actorId: admin.id,
      action: `erp.command.${action}`,
      entity: `erp:${module}`,
      entityId: result.createdId ?? (ids.join(",") || null),
      diff: { action, ids },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Komanda nije izvršena.";
    await logAudit({
      actorId: admin.id,
      action: `erp.command.${action}.error`,
      entity: `erp:${module}`,
      entityId: ids.join(",") || null,
      diff: { action, ids, error: message },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

async function runCommand(
  module: string,
  action: string,
  ids: string[],
  actorId: string,
): Promise<CommandResult> {
  switch (action) {
    case "row.delete":
      return deleteRows(module, ids);
    case "article.create":
      return createArticle();
    case "lookup.create":
      return createLookupValue();
    case "supplier.create":
      return createSupplier();
    case "price-list.create":
      return createPriceList();
    case "loyalty.create":
      return createLoyaltyRule();
    case "linear-promotion.create":
      return createLinearPromotion();
    case "warehouse.create":
      return createWarehouse();
    case "stock-count.create":
      return createStockCount();
    case "stock-count.post":
      return postStockCounts(ids, actorId);
    case "sales-order.create-vp":
      return createManualSalesOrder(SalesChannel.VP);
    case "sales-order.create-ino":
      return createManualSalesOrder(SalesChannel.INO);
    case "dispatch.create":
      return createDispatchNote();
    case "dispatch.post":
      return postDispatchNotes(ids, actorId);
    case "pickup.create":
      return createPickupBatch();
    case "customer.create":
      return createCustomer();
    case "partner-client.create":
      return createPartnerClient();
    case "landing.create":
      return createLandingPage();
    case "landing-section.create":
      return createLandingSections(ids);
    case "newsletter.create":
      return createNewsletterCampaign();
    case "po-items.validate-packs":
      return validatePurchaseOrderPacks(ids);
    case "po.create":
      return createPurchaseOrder();
    case "po.send":
      return sendPurchaseOrders(ids, actorId);
    case "po.receive":
      return receivePurchaseOrders(ids, actorId);
    case "invoice.create":
      return createInboundInvoice();
    case "invoice.post":
      return postInboundInvoices(ids);
    case "mp.proposal":
      return createRetailProposals(ids, actorId);
    case "mp.publish":
      return publishRetailPrices(ids, actorId);
    default:
      throw new Error("Ova komanda još nije povezana.");
  }
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
    case "porudzbenice":
      count = (await db.purchaseOrder.deleteMany({ where })).count;
      break;
    case "porudzbenice-po-artiklima":
      count = (await db.purchaseOrderItem.deleteMany({ where })).count;
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

async function createArticle(): Promise<CommandResult> {
  const product = await db.$transaction(async (tx) => {
    const sku = await nextArticleSku(tx);
    return tx.product.create({
      data: {
        sku,
        slug: `${articleSlug(sku)}-${randomBytes(3).toString("hex")}`,
        name: "Novi artikal",
        shortName: "Novi artikal",
        description: "Dopuniti opis za sajt.",
        fullPrice: 0,
        articleStatus: "UZ",
        isActive: false,
      },
    });
  });
  return {
    message: `Artikal ${product.sku} je kreiran neobjavljen. Dopunite obavezna polja.`,
    createdId: product.id,
    redirect: `/admin/proizvodi/${product.id}`,
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
  const supplier = await withUniqueRetry(async () => {
    const count = await db.supplier.count();
    return db.supplier.create({
      data: { name: `Novi dobavljač ${count + 1}` },
    });
  });
  return { message: "Dobavljač je kreiran. Popunite podatke u redu.", createdId: supplier.id };
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

async function createWarehouse(): Promise<CommandResult> {
  const warehouse = await withUniqueRetry(async () => {
    const count = await db.warehouse.count();
    const serial = String(count + 1).padStart(2, "0");
    return db.warehouse.create({
      data: {
        code: `MAG-${serial}`,
        name: `Novi magacin ${serial}`,
        active: false,
      },
    });
  });
  return { message: `Magacin ${warehouse.code} je kreiran isključen.`, createdId: warehouse.id };
}

async function defaultWarehouse() {
  return db.warehouse.findFirst({
    where: { active: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

async function createStockCount(): Promise<CommandResult> {
  const warehouse = await defaultWarehouse();
  if (!warehouse) throw new Error("Nema aktivnog magacina za novi popis.");
  const year = new Date().getFullYear();
  const stockCount = await withUniqueRetry(async () => {
    const count = await db.stockCount.count({
      where: { number: { startsWith: `POP-${year}-` } },
    });
    return db.stockCount.create({
      data: {
        number: `POP-${year}-${String(count + 1).padStart(4, "0")}`,
        warehouseId: warehouse.id,
      },
    });
  });
  return { message: `Popis ${stockCount.number} je kreiran.`, createdId: stockCount.id };
}

async function createManualSalesOrder(
  channel: typeof SalesChannel.VP | typeof SalesChannel.INO,
): Promise<CommandResult> {
  const year = new Date().getFullYear();
  const prefix = channel === SalesChannel.VP ? "VP" : "INO";
  const order = await withUniqueRetry(async () => {
    const count = await db.order.count({
      where: { number: { startsWith: `${prefix}-${year}-` } },
    });
    return db.order.create({
      data: {
        number: `${prefix}-${year}-${String(count + 1).padStart(5, "0")}`,
        channel,
        subtotal: 0,
        total: 0,
        shippingMethod: ShippingMethod.KURIR,
        paymentMethod: PaymentMethod.UPLATA_NA_RACUN,
        shipFirstName: "Dopuniti",
        shipLastName: "kupca",
        shipPhone: "Dopuniti",
        shipStreet: "Dopuniti",
        shipCity: "Dopuniti",
        shipPostalCode: "00000",
        notes: `Ručna ${prefix} porudžbina — dopuniti kupca, magacine i stavke pre potvrde.`,
        termsAcceptedAt: new Date(),
      },
    });
  });
  return {
    message: `${prefix} porudžbina ${order.number} je kreirana.`,
    createdId: order.id,
    redirect: `/admin/narudzbine/${order.id}`,
  };
}

async function postStockCounts(ids: string[], actorId: string): Promise<CommandResult> {
  requireIds(ids);
  let posted = 0;
  for (const id of ids) {
    const didPost = await db.$transaction(async (tx) => {
      const stockCount = await tx.stockCount.findUnique({
        where: { id },
        include: {
          items: { include: { product: { select: { sku: true } } } },
        },
      });
      if (!stockCount) throw new Error(`Popis ${id} ne postoji.`);
      if (stockCount.status !== DocumentPostingStatus.DRAFT) return false;
      const locked = await tx.stockCount.updateMany({
        where: { id, status: DocumentPostingStatus.DRAFT },
        data: {
          status: DocumentPostingStatus.POSTED,
          postedAt: new Date(),
          actorId,
        },
      });
      if (locked.count !== 1) return false;
      for (const item of stockCount.items) {
        if (item.differenceQty === 0) continue;
        await adjustInventory(tx, {
          idempotencyKey: `stock-count:${stockCount.id}:${item.id}`,
          warehouseId: stockCount.warehouseId,
          productId: item.productId,
          sku: item.product.sku,
          qtyDelta: item.differenceQty,
          kind: StockMovementKind.STOCK_COUNT,
          note: `Popis ${stockCount.number}: ${item.expectedQty} → ${item.countedQty}`,
          actorId,
        });
      }
      return true;
    });
    if (didPost) posted += 1;
  }
  return { message: `Proknjiženo popisa: ${posted}.` };
}

async function createDispatchNote(): Promise<CommandResult> {
  const warehouse = await defaultWarehouse();
  if (!warehouse) throw new Error("Nema aktivnog izvornog magacina.");
  const year = new Date().getFullYear();
  const dispatch = await withUniqueRetry(async () => {
    const count = await db.dispatchNote.count({
      where: { number: { startsWith: `OTP-${year}-` } },
    });
    return db.dispatchNote.create({
      data: {
        number: `OTP-${year}-${String(count + 1).padStart(5, "0")}`,
        sourceWarehouseId: warehouse.id,
      },
    });
  });
  return { message: `Otpremnica ${dispatch.number} je kreirana.`, createdId: dispatch.id };
}

async function postDispatchNotes(ids: string[], actorId: string): Promise<CommandResult> {
  requireIds(ids);
  let posted = 0;
  for (const id of ids) {
    const didPost = await db.$transaction(async (tx) => {
      const dispatch = await tx.dispatchNote.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!dispatch) throw new Error(`Otpremnica ${id} ne postoji.`);
      if (dispatch.status !== DocumentPostingStatus.DRAFT) return false;
      if (
        dispatch.type === DispatchNoteType.INTERNAL &&
        !dispatch.destinationWarehouseId
      ) {
        throw new Error(`Interna otpremnica ${dispatch.number} nema odredišni magacin.`);
      }
      const locked = await tx.dispatchNote.updateMany({
        where: { id, status: DocumentPostingStatus.DRAFT },
        data: {
          status: DocumentPostingStatus.POSTED,
          postedAt: new Date(),
          actorId,
        },
      });
      if (locked.count !== 1) return false;
      for (const item of dispatch.items) {
        if (!item.productId) {
          throw new Error(`Stavka ${item.sku} nema vezan artikal.`);
        }
        await adjustInventory(tx, {
          idempotencyKey: `dispatch:${dispatch.id}:${item.id}:out`,
          warehouseId: dispatch.sourceWarehouseId,
          productId: item.productId,
          sku: item.sku,
          qtyDelta: -item.qty,
          kind:
            dispatch.type === DispatchNoteType.INTERNAL
              ? StockMovementKind.INTERNAL_TRANSFER_OUT
              : StockMovementKind.DISPATCH,
          note: `Otpremnica ${dispatch.number}`,
          actorId,
        });
        if (
          dispatch.type === DispatchNoteType.INTERNAL &&
          dispatch.destinationWarehouseId
        ) {
          await adjustInventory(tx, {
            idempotencyKey: `dispatch:${dispatch.id}:${item.id}:in`,
            warehouseId: dispatch.destinationWarehouseId,
            productId: item.productId,
            sku: item.sku,
            qtyDelta: item.qty,
            kind: StockMovementKind.INTERNAL_TRANSFER_IN,
            note: `Interni prijem po otpremnici ${dispatch.number}`,
            actorId,
          });
        }
      }
      return true;
    });
    if (didPost) posted += 1;
  }
  return { message: `Proknjiženo otpremnica: ${posted}.` };
}

async function createPickupBatch(): Promise<CommandResult> {
  const year = new Date().getFullYear();
  const batch = await withUniqueRetry(async () => {
    const count = await db.pickupBatch.count({
      where: { number: { startsWith: `PRE-${year}-` } },
    });
    return db.pickupBatch.create({
      data: {
        number: `PRE-${year}-${String(count + 1).padStart(4, "0")}`,
        configurationIssue:
          "Izaberite kurira; rezervacija preuzimanja ostaje isključena dok provider health check ne bude zelen.",
      },
    });
  });
  return { message: `Pickup batch ${batch.number} je kreiran.`, createdId: batch.id };
}

async function createCustomer(): Promise<CommandResult> {
  const count = await db.customer.count();
  const customer = await db.customer.create({
    data: {
      firstName: "Novi",
      lastName: `kupac ${count + 1}`,
      gender: "NEPOZNATO",
    },
  });
  return { message: "Kupac je kreiran; pol ostaje NEPOZNATO do ručne izmene.", createdId: customer.id };
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

async function createPurchaseOrder(): Promise<CommandResult> {
  // Spec §4.1.1: number runs by sequence within the current year, e.g. 1/26.
  const yy = String(new Date().getFullYear()).slice(-2);
  const order = await withUniqueRetry(async () => {
    const existing = await db.purchaseOrder.count({
      where: { number: { endsWith: `/${yy}` } },
    });
    const number = `${existing + 1}/${yy}`;
    return db.purchaseOrder.create({
      data: { number, status: PurchaseOrderStatus.DRAFT },
    });
  });
  return {
    message: `Porudžbenica ${order.number} je kreirana (status: U obradi).`,
    createdId: order.id,
    redirect: `/admin/erp/porudzbenice/${order.id}`,
  };
}

async function createInboundInvoice(): Promise<CommandResult> {
  const year = new Date().getFullYear();
  const invoice = await withUniqueRetry(async () => {
    const count = await db.inboundInvoice.count({
      where: { number: { startsWith: `UF-${year}-` } },
    });
    const number = `UF-${year}-${String(count + 1).padStart(4, "0")}`;
    return db.inboundInvoice.create({
      data: {
        number,
        type: InboundInvoiceType.DOM,
        status: InboundInvoiceStatus.DRAFT,
      },
    });
  });
  return { message: `Faktura ${invoice.number} je kreirana.`, createdId: invoice.id };
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

async function postInboundInvoices(ids: string[]): Promise<CommandResult> {
  requireIds(ids);
  const count = await db.$transaction(async (tx) => {
    let posted = 0;
    for (const id of ids) {
      const invoice = await tx.inboundInvoice.findUnique({
        where: { id },
        include: {
          items: true,
          purchaseOrder: { include: { items: true } },
        },
      });
      if (!invoice) throw new Error(`Ulazna faktura ${id} ne postoji.`);
      if (invoice.lockedAt || invoice.status === InboundInvoiceStatus.POSTED) continue;
      const net = Number(invoice.netValue);
      const vat = Number(invoice.vatValue);
      const gross = Number(invoice.grossValue);
      if (Math.abs(net + vat - gross) > 0.01) {
        throw new Error(`Faktura ${invoice.number}: neto + PDV nije jednako bruto vrednosti.`);
      }
      if (invoice.type === InboundInvoiceType.COGS && !invoice.purchaseOrder) {
        throw new Error(`COGS faktura ${invoice.number} mora biti vezana za porudžbenicu.`);
      }
      if (invoice.purchaseOrder) {
        const rate = Number(invoice.exchangeRate);
        if (!Number.isFinite(rate) || rate <= 0) {
          throw new Error(`Faktura ${invoice.number}: kurs mora biti veći od nule.`);
        }
        const allocations = allocateLandedCost(
          net * rate,
          invoice.purchaseOrder.items.map((item) => ({
            id: item.id,
            purchasePrice: Number(item.purchasePrice),
            qty: item.qty,
            totalWeight: Number(item.totalWeight ?? 0),
            totalVolume: Number(item.totalVolume ?? 0),
            manualAmount:
              invoice.allocationBasis === "MANUAL"
                ? invoice.items
                    .filter(
                      (line) =>
                        (line.productId && line.productId === item.productId) ||
                        (line.sku && line.sku === item.sku),
                    )
                    .reduce((sum, line) => sum + Number(line.total) * rate, 0)
                : null,
          })),
          invoice.allocationBasis,
        );
        for (const item of invoice.purchaseOrder.items) {
          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: {
              additionalCostAllocated:
                Number(item.additionalCostAllocated ?? 0) +
                (allocations.get(item.id) ?? 0),
            },
          });
        }
      }
      await tx.inboundInvoice.update({
        where: { id },
        data: {
          status: InboundInvoiceStatus.POSTED,
          cogsStatus: invoice.purchaseOrder ? CogsStatus.CALCULATED : CogsStatus.PENDING,
          lockedAt: new Date(),
        },
      });
      posted += 1;
    }
    return posted;
  });
  return { message: `Proknjiženo faktura: ${count}.` };
}

// MP-cene rows are products, so `ids` are product ids.
async function createRetailProposals(ids: string[], actorId: string): Promise<CommandResult> {
  requireIds(ids);
  const products = await db.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, sku: true, name: true, fullPrice: true, salePrice: true },
  });
  let count = 0;
  for (const product of products) {
    await db.retailPriceProposal.create({
      data: {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        currentMpc: product.salePrice ?? product.fullPrice,
        proposedMpc: product.fullPrice,
        status: RetailPriceProposalStatus.PREDLOG,
        actorId,
      },
    });
    count += 1;
  }
  return {
    message: `Kreirano predloga cena: ${count}. Uredite „Kalkulativnu MPC“ pre objave.`,
  };
}

async function publishRetailPrices(ids: string[], actorId: string): Promise<CommandResult> {
  requireIds(ids);
  let published = 0;
  for (const productId of ids) {
    const proposal = await db.retailPriceProposal.findFirst({
      where: { productId, status: RetailPriceProposalStatus.PREDLOG },
      orderBy: { createdAt: "desc" },
    });
    if (!proposal) continue;

    await db.$transaction([
      // Archive any previously published price for this product.
      db.retailPriceProposal.updateMany({
        where: { productId, status: RetailPriceProposalStatus.OBJAVLJENO },
        data: { status: RetailPriceProposalStatus.ARHIVA },
      }),
      db.retailPriceProposal.update({
        where: { id: proposal.id },
        data: {
          status: RetailPriceProposalStatus.OBJAVLJENO,
          publishedAt: new Date(),
          actorId,
        },
      }),
      db.product.update({
        where: { id: productId },
        data: { salePrice: proposal.proposedMpc },
      }),
    ]);
    published += 1;
  }
  if (published > 0) revalidatePath("/");
  return { message: `Objavljeno cena: ${published}.` };
}
