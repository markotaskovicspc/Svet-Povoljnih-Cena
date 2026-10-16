import "server-only";
import { getEmailConfig } from "@/lib/email/config";
import { trackedDispatch } from "@/lib/email/tracking";
import { getPickingSession } from "./picking.server";

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** Morning work instructions; generating courier labels remains a warehouse action. */
export async function sendWarehouseMorningEmail(payload: { batchId: string; provider: "MYGLS" | "X_EXPRESS"; date: string }) {
  const session = await getPickingSession(payload.batchId);
  const baseUrl = getEmailConfig().baseUrl.replace(/\/$/, "");
  const pickingUrl = `${baseUrl}/admin/magacin/picking/${encodeURIComponent(session.id)}`;
  const returnsUrl = `${baseUrl}/admin/magacin/povrat`;
  const provider = payload.provider === "MYGLS" ? "GLS" : "X Express";
  const text = [
    `Jutarnji pregled magacina · ${payload.date} · ${provider}`,
    `Picking nalog: ${session.number}. Pregled je stanje u trenutku slanja; aktuelne količine proverite u nalogu.`,
    ...session.rows.map(row => `${row.sku} · ${row.name} · ${row.quantity} kom. · ${row.warehouseName}${row.positions.length ? ` · Pozicije: ${row.positions.join(", ")}` : ""}`),
    ...(session.rows.length ? [] : ["Nema artikala za odvajanje u ovom nalogu."]),
    `Otvori picking nalog: ${pickingUrl}`,
    "Posle provere i pakovanja, jednim dugmetom kreirajte i otvorite adresnice za štampu.",
    `Prijem povrata — skenirajte paket i proverite sadržaj: ${returnsUrl}`,
  ].join("\n\n");
  const result = await trackedDispatch({
    kind: "WAREHOUSE_MORNING", to: "magacin@svetpovoljnihcena.rs",
    subject: `Magacin · ${payload.date} · ${provider} · ${session.number}`,
    text, html: `<p>${escape(text).replace(/\n/g, "<br>")}</p><p><a href="${escape(pickingUrl)}">Otvori picking nalog</a> · <a href="${escape(returnsUrl)}">Prijem povrata</a></p>`,
    idempotencyKey: `warehouse-morning:${payload.date}:${payload.provider}`,
    metadata: { batchId: payload.batchId, date: payload.date, provider: payload.provider },
  });
  if (!result.ok) throw new Error(result.error);
}
