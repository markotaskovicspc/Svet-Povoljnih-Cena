import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import { resolveOrderDocumentBuyerAddress } from "@/lib/document-buyer";
import { requireSefConfig } from "./config";
import { SefApiError, SefClient } from "./client";
import { ensureSefInventoryPosted } from "./inventory.server";
import { buildSalesInvoiceUbl, readInvoiceXml } from "./ubl";

const digest = (xml: string) => createHash("sha256").update(xml).digest("hex");
export const sefXmlDigest = digest;

export async function queueSefSync(from: string, to: string, actorId: string | null) {
  const config = requireSefConfig();
  const start = new Date(from + "T00:00:00Z"), end = new Date(to + "T23:59:59.999Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end || end.getTime() - start.getTime() > 31 * 86400000) throw new Error("Izaberite period do 31 dan.");
  let count = 0;
  for (let day = start.getTime(); day <= end.getTime(); day += 86400000) {
    await enqueueBackgroundJob({ kind: "SEF_INBOX_DISCOVER", payload: { day: new Date(day).toISOString().slice(0, 10), environment: config.environment, actorId }, idempotencyKey: `sef-discover:${config.environment}:${day}:${Date.now()}` });
    count++;
  }
  return count;
}

export async function discoverSefInvoices(dayString: string, environment: string, actorId: string | null) {
  const config = requireSefConfig();
  if (config.environment !== environment) throw new Error("SEF okruženje se promenilo.");
  const client = new SefClient(config);
  const start = new Date(dayString + "T00:00:00Z"), end = new Date(start.getTime() + 86400000 - 1);
  let count = 0;
  for (let day = start.getTime(); day <= end.getTime(); day += 86400000) {
    const ids = await client.listPurchaseInvoiceIds({ dateFrom: new Date(day), dateTo: new Date(Math.min(day + 86400000, end.getTime() + 1)) });
    if (ids.length > 2000) throw new Error("SEF je vratio više od 2000 računa u danu; suzite period.");
    const run = Date.now();
    for (let offset = 0; offset < ids.length; offset += 5) {
      await enqueueBackgroundJob({ kind: "SEF_INBOX_DOWNLOAD", payload: { ids: ids.slice(offset, offset + 5), environment: config.environment, actorId }, idempotencyKey: `sef-inbox:${config.environment}:${day}:${run}:${offset}` });
    }
    count += ids.length;
  }
  return count;
}

export async function downloadSefInvoices(ids: number[], environment: string, actorId: string | null) {
  const config = requireSefConfig();
  if (config.environment !== environment) throw new Error("SEF okruženje se promenilo; ponovite sinhronizaciju.");
  const client = new SefClient(config);
  for (const id of ids) {
    const existing = await db.sefDocument.findUnique({ where: { environment_direction_remoteId: { environment, direction: "IN", remoteId: String(id) } }, select: { id: true } });
    if (existing) continue;
    const xml = await client.purchaseInvoiceXml(id);
    const { attachments: _attachments, ...data } = readInvoiceXml(xml);
    if (data.customerPib !== MERCHANT_LEGAL_INFO.pib) throw new Error("SEF račun pripada drugoj firmi. Proverite API ključ za SPC.");
    await db.sefDocument.upsert({ where: { environment_direction_remoteId: { environment, direction: "IN", remoteId: String(id) } },
      create: { ...data, xml, environment, direction: "IN", remoteId: String(id), actorId },
      update: { ...data, xml } });
  }
}

async function salesOrderData(orderId: string, number: string, issueDate: string, dueDate: string, database: Prisma.TransactionClient = db) {
  const order = await database.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { orderBy: { id: "asc" } }, customer: true, priceList: true, fiscalDocuments: { select: { id: true }, take: 1 } } });
  if (["OTKAZANO", "VRACENO"].includes(order.status) || !["VP", "MP"].includes(order.channel)) throw new Error("Ovaj nalog nije dostupan za SEF fakturu.");
  if (order.fiscalDocuments.length) throw new Error("Nalog već ima fiskalni račun. Elektronska faktura za fiskalizovan promet zahteva zaseban računovodstveni postupak; nije dozvoljeno dupliranje prometa.");
  if ((order.priceList?.currency ?? "RSD") !== "RSD" || order.shipCountry !== "RS") throw new Error("Podržane su domaće fakture u RSD.");
  if (order.items.some(item => item.supplierReservedQty > 0)) throw new Error("SEF faktura zahteva preuzetu robu u magacinu. Nalog još ima rezervaciju kod dobavljača; prvo završite prijem robe.");
  const buyer = resolveOrderDocumentBuyerAddress(order);
  const result = buildSalesInvoiceUbl({ number, issueDate, dueDate, orderNumber: order.number,
    seller: { name: MERCHANT_LEGAL_INFO.name, pib: MERCHANT_LEGAL_INFO.pib, registrationNumber: MERCHANT_LEGAL_INFO.registrationNumber, street: "Jurija Gagarina 32", city: "Novi Beograd", postalCode: "11070" },
    buyer: { name: buyer.companyName || "", pib: buyer.pib || "", registrationNumber: order.customer?.registrationNumber ?? undefined, street: buyer.street, city: buyer.city, postalCode: buyer.postalCode },
    total: Number(order.total), shipping: Number(order.shipping), assembly: Number(order.assemblyTotal),
    discount: Number(order.voucherDiscount ?? 0) + Number(order.firstPurchaseDiscount ?? 0) + Number(order.savedCardDiscount ?? 0),
    lines: order.items.map(item => ({ sku: item.sku, name: item.shortNameSnapshot ?? item.name, qty: item.qty, unitGross: Number(item.unitPriceSale) })) });
  return { ...result, ...readInvoiceXml(result.xml), orderId, inventorySnapshot: order.items.map(item => ({ id: item.id, productId: item.productId, sku: item.sku, qty: item.qty, warehouseId: item.warehouseId, warehouseReservedQty: item.warehouseReservedQty, supplierReservedQty: item.supplierReservedQty })) };
}

export async function prepareSefInvoice(orderId: string, number: string, issueDate: string, dueDate: string, actorId: string) {
  const config = requireSefConfig();
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const { attachments: _attachments, ...data } = await salesOrderData(orderId, number, issueDate, dueDate, tx);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`sef-out:${config.environment}:${orderId}`}))::text`;
    const existing = await tx.sefDocument.findUnique({ where: { environment_direction_orderId: { environment: config.environment, direction: "OUT", orderId } } });
    if (existing && !["DRAFT", "ERROR"].includes(existing.status)) throw new Error("Faktura je već poslata ili njen prethodni zahtev još nije potvrđen.");
    const requestId = `spc-${config.environment}-${orderId}-${digest(data.xml).slice(0, 12)}`;
    if (existing) return tx.sefDocument.update({ where: { id: existing.id }, data: { ...data, requestId, status: "DRAFT", error: null } });
    return tx.sefDocument.create({ data: { ...data, environment: config.environment, direction: "OUT", requestId, status: "DRAFT", actorId } });
  });
}

export async function sendSefInvoice(id: string, fingerprint: string) {
  const config = requireSefConfig();
  const doc = await db.sefDocument.findUniqueOrThrow({ where: { id } });
  if (doc.direction !== "OUT" || doc.environment !== config.environment || !doc.orderId || !doc.requestId) throw new Error("Faktura ne pripada aktivnom SEF okruženju.");
  if (doc.sentAt) { await ensureSefInventoryPosted(id); return doc; }
  if (digest(doc.xml) !== fingerprint) throw new Error("Pregled fakture je promenjen. Otvorite ga ponovo.");
  const claimed = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${doc.orderId} FOR UPDATE`;
    const latest = await tx.sefDocument.findUniqueOrThrow({ where: { id } });
    if (digest(latest.xml) !== fingerprint) throw new Error("Faktura je promenjena. Ponovo otvorite pregled.");
    const current = await salesOrderData(doc.orderId!, doc.number, doc.issueDate.toISOString().slice(0, 10), doc.dueDate!.toISOString().slice(0, 10), tx);
    if (JSON.stringify(current.inventorySnapshot) !== JSON.stringify(latest.inventorySnapshot)) throw new Error("Rezervacija je izmenjena. Ponovo pripremite fakturu.");
    if (digest(current.xml) !== fingerprint) throw new Error("Nalog je izmenjen posle pripreme fakture. Ponovo pripremite fakturu.");
    return tx.sefDocument.updateMany({ where: { id, sentAt: null, status: { in: ["DRAFT", "ERROR"] } }, data: { status: "SENDING", error: null } });
  });
  if (claimed.count !== 1) throw new Error("Zahtev je već u toku ili čeka proveru na SEF-u.");
  try {
    const response = await new SefClient(config).submitInvoice(doc.xml, doc.requestId);
    const submitted = await db.sefDocument.update({ where: { id }, data: { remoteId: String(response.invoiceId), status: "SUBMITTED", sentAt: new Date() } });
    return submitted;
  } catch (error) {
    const definite = error instanceof SefApiError && error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
    await db.sefDocument.update({ where: { id }, data: { status: definite ? "ERROR" : "UNKNOWN", error: error instanceof Error ? error.message : "SEF zahtev nije potvrđen." } });
    throw new Error(definite ? "SEF je odbio zahtev. Proverite podatke fakture." : "Ishod slanja nije potvrđen. Proverite fakturu na SEF portalu pre ponovnog slanja; ERP blokira duplikat.");
  }
}

export async function refreshSefInvoice(id: string, recoveredRemoteId?: number) {
  const config = requireSefConfig();
  const doc = await db.sefDocument.findUniqueOrThrow({ where: { id } });
  if (doc.environment !== config.environment) throw new Error("Faktura nije u aktivnom SEF okruženju.");
  const remoteId = recoveredRemoteId ?? Number(doc.remoteId);
  if (!Number.isSafeInteger(remoteId) || remoteId <= 0) throw new Error("Unesite SEF ID fakture sa portala.");
  const client = new SefClient(config);
  if (recoveredRemoteId) {
    if (doc.direction !== "OUT" || !["UNKNOWN", "SENDING"].includes(doc.status)) throw new Error("Ručna provera je dostupna samo za nepotvrđen zahtev.");
    const remote = readInvoiceXml(await client.salesInvoiceXml(remoteId));
    if (remote.number !== doc.number || remote.supplierPib !== doc.supplierPib || remote.customerPib !== doc.customerPib || remote.currency !== doc.currency || Math.abs(remote.gross - Number(doc.gross)) > .01) throw new Error("SEF ID ne odgovara ovoj fakturi. Nije promenjen status.");
  }
  const status = await client.invoiceStatus(doc.direction === "OUT" ? "sales" : "purchase", remoteId);
  const refreshed = await db.$transaction(async tx => {
    const result = await tx.sefDocument.update({ where: { id }, data: { status, remoteId: String(remoteId), ...(recoveredRemoteId ? { sentAt: new Date(), error: null } : {}) } });
    if (doc.direction === "OUT" && doc.orderId && status.toLowerCase() === "approved") await tx.order.update({ where: { id: doc.orderId }, data: { sefAcceptedAt: new Date() } });
    return result;
  });
  if (doc.direction === "OUT") await ensureSefInventoryPosted(id);
  return refreshed;
}
