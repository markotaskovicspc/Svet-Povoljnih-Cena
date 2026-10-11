"use server";
import { ensureSefInventoryPosted } from "@/lib/sef/inventory.server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminAction, logAudit } from "@/lib/admin";
import { db } from "@/lib/db";
import { queueSefSync, prepareSefInvoice, sendSefInvoice, refreshSefInvoice, sefXmlDigest } from "@/lib/sef/documents.server";
import { readInvoiceXml } from "@/lib/sef/ubl";
import { parseStatementFile } from "@/lib/courier/statement-file";
import { previewStatement } from "@/lib/courier/finance.server";
import { carrierSchema } from "@/lib/courier/finance";

async function action<T>(name: string, run: (actorId: string) => Promise<T>) {
  const actor = await requireAdminAction(["OPS"]);
  try {
    const result = await run(actor.id);
    await logAudit({ actorId: actor.id, action: name, entity: "SefDocument", diff: { ok: true } });
    revalidatePath("/admin/erp/sef");
    return { ok: true as const, result };
  } catch (error) { return { ok: false as const, message: error instanceof Error ? error.message : "SEF akcija nije uspela." }; }
}
export async function syncSef(form: FormData) {
  return action("sef.inbox.sync", async actorId => {
    const count = await queueSefSync(String(form.get("from") || ""), String(form.get("to") || ""), actorId);
    return { message: `${count} dana je dodato za sinhronizaciju. Preuzimanje je u redu poslova; osvežite pregled nakon obrade.` };
  });
}
export async function prepareInvoice(form: FormData) {
  return action("sef.sales.prepare", async actorId => {
    const order = await db.order.findUniqueOrThrow({ where: { number: z.string().trim().min(1).max(100).parse(form.get("orderNumber")) }, select: { id: true } });
    const doc = await prepareSefInvoice(order.id, String(form.get("number") || "").trim(), String(form.get("date") || ""), String(form.get("due") || ""), actorId);
    return { id: doc.id, fingerprint: sefXmlDigest(doc.xml), number: doc.number, customer: doc.customerName, pib: doc.customerPib, net: Number(doc.net), vat: Number(doc.vat), gross: Number(doc.gross), date: doc.issueDate.toISOString().slice(0, 10), due: doc.dueDate?.toISOString().slice(0, 10) };
  });
}
export async function submitInvoice(id: string, fingerprint: string) {
  return action("sef.sales.send", async () => {
    const doc = await sendSefInvoice(z.string().min(1).parse(id), z.string().regex(/^[a-f0-9]{64}$/).parse(fingerprint));
    await ensureSefInventoryPosted(doc.id);
    return { message: `Faktura ${doc.number} je predata SEF-u. SEF ID: ${doc.remoteId}.` };
  });
}
export async function previewSefCourierAttachment(form: FormData) {
  return action("sef.courier.preview", async () => {
    const doc = await db.sefDocument.findUniqueOrThrow({ where: { id: String(form.get("id") || "") } });
    if (doc.direction !== "IN" || doc.currency !== "RSD") throw new Error("Izaberite ulazni kurirski račun u RSD.");
    const attachment = readInvoiceXml(doc.xml).attachments[z.coerce.number().int().min(0).parse(form.get("index"))];
    if (!attachment || !/\.(xlsx|csv)$/i.test(attachment.filename)) throw new Error("PDF prilog prepišite u kurirski CSV obrazac pa otvorite pregled u Kurirskom obračunu.");
    const provider = carrierSchema.parse(form.get("provider"));
    const rows = await parseStatementFile(Buffer.from(attachment.base64, "base64"), attachment.filename, provider, doc.issueDate.toISOString().slice(0, 10));
    const preview = await previewStatement({ provider, documentNo: doc.number, filename: attachment.filename, rows });
    if (Math.abs(preview.costNet - Number(doc.net)) > .01 || rows.some(r => r.kind !== "COST")) throw new Error("Specifikacija nije potpuna ili zbir troškova ne odgovara SEF računu. Pregledajte PDF i koristite standardni obrazac.");
    return preview;
  });
}

export async function refreshInvoice(form: FormData) {
  return action("sef.invoice.status", async () => {
    const remote = form.get("remoteId");
    const doc = await refreshSefInvoice(String(form.get("id") || ""), remote ? z.coerce.number().int().positive().parse(remote) : undefined);
    return { message: `SEF status fakture ${doc.number}: ${doc.status}.` };
  });
}
