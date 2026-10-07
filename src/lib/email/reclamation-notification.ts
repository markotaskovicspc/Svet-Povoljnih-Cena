import "server-only";
import { db } from "@/lib/db";
import { getEmailConfig } from "./config";
import { trackedDispatch } from "./tracking";

export async function sendReclamationNotification(reclamationId: string) {
  const row = await db.reclamation.findUnique({
    where: { id: reclamationId },
    include: { order: { select: { number: true } }, photos: { select: { id: true } } },
  });
  if (!row) throw new Error("Reclamation not found");
  const cfg = getEmailConfig();
  const url = `${cfg.baseUrl}/admin/erp/reklamacije-dnevnik/${encodeURIComponent(row.id)}`;
  const text = [
    `Nova reklamacija ${row.number} — potrebna je obrada`,
    `Porudžbina: ${row.order.number}`,
    `Artikal: ${row.sku} × ${row.quantity}`,
    `Kupac: ${row.customerFirst} ${row.customerLast}`,
    `Telefon: ${row.customerPhone || "nije naveden"}`,
    `Email: ${row.customerEmail || "nije naveden"}`,
    `Vrsta zahteva: ${row.type || "nije navedena"}`,
    `Željeno rešenje: ${row.request || "dogovor sa podrškom"}`,
    `Opis problema: ${row.description}`,
    `Fotografije: ${row.photos.length} (u ERP-u)`,
    "", `Otvori reklamaciju u ERP-u: ${url}`,
    "Prijava ne znači da je povraćaj novca ili zamena odobrena.",
  ].join("\n");
  const escaped = text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  return trackedDispatch({
    kind: "reclamation_notification", to: cfg.reclamationsInbox,
    subject: `Nova reklamacija ${row.number} — ${row.order.number}`,
    text, html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escaped}</div><p><a href="${url}">Otvori reklamaciju u ERP-u</a></p>`,
    tags: { kind: "reclamation_notification", reclamation: row.id },
    idempotencyKey: `reclamation-notification:${row.id}`,
  });
}
