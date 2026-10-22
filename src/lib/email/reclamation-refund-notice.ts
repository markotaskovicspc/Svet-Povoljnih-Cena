import "server-only";
import { isUnpaidCodReturn } from "@/lib/admin/reclamation-refund";
import { num } from "@/lib/api/_helpers";
import { db } from "@/lib/db";
import { needsReclamationRefundNotice, reclamationRefundNoticeKey, reclamationReturnReceiptsWhere } from "@/lib/admin/reclamation-refund-notice.server";
import { getEmailConfig } from "./config";
import { trackedDispatch } from "./tracking";

export async function sendReclamationRefundOfficeNotice(reclamationId: string) {
  const claim = await db.reclamation.findUnique({
    where: { id: reclamationId },
    include: { order: { select: { number: true, channel: true, paymentMethod: true, courierPaidAt: true, payments: { select: { status: true } }, shipments: { where: { purpose: "ORDER_DELIVERY" }, select: { purpose: true, status: true, deliveredAt: true } } } }, product: { select: { name: true } } },
  });
  if (!claim || !needsReclamationRefundNotice(claim) || isUnpaidCodReturn(claim.order)) return;
  const receipts = await db.stockMovement.findMany({
    where: reclamationReturnReceiptsWhere(reclamationId), orderBy: { createdAt: "desc" },
    include: { warehouse: { select: { code: true, name: true } } },
  });
  const quantity = receipts.reduce((sum, row) => sum + row.qty, 0);
  if (!receipts.length || claim.quantity <= 0 || quantity < claim.quantity) return;
  const receipt = receipts[0];
  const cfg = getEmailConfig();
  if (cfg.provider === "none") throw new Error("Email provider nije podešen za obaveštenje o povratu novca.");
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/admin/erp/reklamacije-dnevnik/${encodeURIComponent(claim.id)}`;
  const receivedAt = receipt.createdAt.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" });
  const product = claim.product?.name ?? claim.sku;
  const warehouse = [...new Set(receipts.map(row => `${row.warehouse.code} · ${row.warehouse.name}`))].join(", ");
  const payout = await db.paymentRefund.findUnique({ where: { idempotencyKey: `reclamation-refund:${claim.id}` }, select: { amount: true, status: true } });
  const automatic = claim.order.channel !== "ANANAS" ? "ERP automatski obrađuje fiskalnu refundaciju za ovu reklamaciju; status i eventualnu grešku proverite preko linka ispod." : "Fiskalnu obradu ove Ananas reklamacije proverite u odgovarajućem sistemu.";
  const instruction = "Roba je primljena u magacin, a odobreno rešenje reklamacije je povrat novca. " + automatic + " Pre bilo kakve uplate proverite da li je kupcu novac već vraćen, da se ista isplata ne ponovi. Ako nije, organizujte povrat novca na račun kupca. Ovo obaveštenje ne potvrđuje da je novac isplaćen.";
  const details = [
    ["Reklamacija", claim.number], ["Porudžbina", claim.order.number],
    ["Artikal", `${product} · ${claim.sku}`], ["Primljeno komada", String(quantity)],
    ["Iznos za proveru isplate", payout ? `${num(payout.amount).toFixed(2)} RSD` : "Proverite u ERP-u nakon fiskalne obrade"],
    ["Evidencija isplate", payout?.status === "COMPLETED" ? "Već potvrđena u ERP-u — ne ponavljati uplatu" : "Potrebna provera da li je novac već vraćen"],
    ["Magacin", warehouse], ["Prijem robe", receivedAt],
  ];
  const result = await trackedDispatch({
    kind: "reclamation_refund_office", to: cfg.reclamationRefundNotificationTo,
    subject: `Povrat primljen — proverite da li je novac već vraćen · ${claim.number}`,
    html: `<!doctype html><html lang="sr-Latn"><body style="font-family:Arial,sans-serif;color:#1a1714;padding:24px"><h1 style="font-size:24px;color:#d7263d">Provera isplate kupcu</h1><p>${instruction}</p><table>${details.map(([label, value]) => `<tr><th style="text-align:left;padding:8px">${escapeHtml(label)}</th><td style="padding:8px">${escapeHtml(value)}</td></tr>`).join("")}</table><p><a href="${escapeHtml(url)}">Otvori reklamaciju u ERP-u</a></p></body></html>`,
    text: `${instruction}\n\n${details.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\nERP: ${url}`,
    tags: { kind: "reclamation_refund_office" },
    metadata: { reclamationId, orderId: claim.orderId, receiptId: receipt.id, receiptIds: receipts.map(row => row.id) },
    idempotencyKey: reclamationRefundNoticeKey(claim.id),
  });
  if (!result.ok) throw new Error(result.error);
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
