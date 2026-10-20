import "server-only";
import { db } from "@/lib/db";
import { getEmailConfig } from "./config";
import { trackedDispatch } from "./tracking";
import { returnParcelNumbers } from "@/lib/admin/return-parcels";

export async function sendReturnReviewOfficeNotice(input: { shipmentId: string; parcelNumber: string }) {
  const shipment = await db.shipment.findUnique({
    where: { id: input.shipmentId },
    include: { order: { select: { number: true } }, reclamation: { select: { id: true, number: true } } },
  });
  if (!shipment || !returnParcelNumbers(shipment).includes(input.parcelNumber)) throw new Error("Paket nije povezan sa pošiljkom za proveru.");
  const cfg = getEmailConfig();
  if (cfg.provider === "none") throw new Error("Email provider nije podešen za obaveštenje o ručnoj proveri povrata.");
  const base = cfg.baseUrl.replace(/\/$/, "");
  const detail = shipment.reclamation
    ? `${base}/admin/erp/reklamacije-dnevnik/${encodeURIComponent(shipment.reclamation.id)}`
    : `${base}/admin/erp/prodajni-nalozi/${encodeURIComponent(shipment.orderId)}`;
  const text = [
    "Pri pretrazi povratnog paketa sadržaj nije mogao pouzdano da se poveže sa artiklima. Potrebna je ručna provera pre prijema robe.",
    `Paket: ${input.parcelNumber}`, `Porudžbina: ${shipment.order.number}`,
    ...(shipment.reclamation ? [`Reklamacija: ${shipment.reclamation.number}`] : []),
    `Kurir: ${shipment.provider ?? shipment.service}`,
    "Ovo obaveštenje ne potvrđuje fizički prijem, ne povećava lager i ne pokreće refundaciju.",
    `Detalji: ${detail}`,
    `Skenirani paket: ${base}/admin/erp/povrati?q=${encodeURIComponent(input.parcelNumber)}`,
  ].join("\n\n");
  const escaped = text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const result = await trackedDispatch({
    kind: "return_review_office", to: "office@svetpovoljnihcena.rs",
    subject: `Povrat zahteva ručnu proveru · ${shipment.order.number} · ${input.parcelNumber}`,
    text, html: `<p>${escaped.replace(/\n/g, "<br>")}</p>`,
    idempotencyKey: `return-review:${shipment.id}:${input.parcelNumber}`,
    metadata: { shipmentId: shipment.id, parcelNumber: input.parcelNumber, orderId: shipment.orderId },
  });
  if (!result.ok) throw new Error(result.error);
}
