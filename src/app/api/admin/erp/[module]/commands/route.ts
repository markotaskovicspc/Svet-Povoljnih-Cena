import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  InboundInvoiceStatus,
  InboundInvoiceType,
  Prisma,
  PurchaseOrderStatus,
  RetailPriceProposalStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit, requireAdminAction } from "@/lib/admin";
import { receivePurchaseOrder, sendPurchaseOrder } from "@/lib/admin/po";

type CommandResult = { message: string; createdId?: string; redirect?: string };

export async function POST(
  req: Request,
  ctx: { params: Promise<{ module: string }> },
) {
  const admin = await requireAdminAction(["OPS"]);
  const { module } = await ctx.params;
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
    case "supplier.create":
      return createSupplier();
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
    default:
      throw new Error("Brisanje nije podržano za ovaj modul.");
  }
  return { message: `Obrisano: ${count}.` };
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
  const count = (
    await db.inboundInvoice.updateMany({
      where: { id: { in: ids } },
      data: { status: InboundInvoiceStatus.POSTED },
    })
  ).count;
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
