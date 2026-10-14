import "server-only";
import { trackedDispatch } from "@/lib/email/tracking";
import { getPickingSession } from "./picking.server";
import { pickingReview } from "./picking-review";
import { buildPickupLabelsResponse } from "./pickup-labels.server";
import type { PickingNotification } from "./picking-notification";

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export async function sendPickingNotification(payload: PickingNotification) {
  const labels = payload.mode === "labels";
  const text = labels ? `Adresnice za nalog ${payload.batchNumber} nalaze se u PDF prilogu.` :
    [`Prijava manjka za picking nalog ${payload.batchNumber}. Količine su stanje u trenutku prijave.`,
      ...payload.shortages.map(row => `${row.sku} · ${row.name}: potrebno ${row.required}, odvojeno ${row.picked}, nedostaje ${row.missing} kom. Porudžbine: ${row.orders.map(order => `${order.number} (${order.quantity} kom. u nalogu)`).join(", ")}.`),
      "Količina manjka nije automatski raspodeljena između porudžbina. Proverite naloge pre slanja robe."].join("\n\n");
  let attachments;
  if (labels) {
    const session = await getPickingSession(payload.batchId);
    if (session.planHash !== payload.planHash || !session.labelsReady || !pickingReview(session).complete) {
      throw new Error("Sadržaj naloga je promenjen ili adresnice nisu spremne. Proverite picking pre ponovnog slanja.");
    }
    const response = await buildPickupLabelsResponse(new Request("https://internal.invalid/labels"), payload.batchId);
    if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) throw new Error("PDF adresnica nije dostupan.");
    attachments = [{ filename: `${payload.batchNumber.replace(/[^a-zA-Z0-9-]/g, "_")}-adresnice.pdf`, content: Buffer.from(await response.arrayBuffer()).toString("base64"), contentType: "application/pdf" }];
  }
  const result = await trackedDispatch({ kind: labels ? "WAREHOUSE_PICKING_LABELS" : "WAREHOUSE_PICKING_SHORTAGE",
    to: labels ? "magacin@svetpovoljnihcena.rs" : "podrska@svetpovoljnihcena.rs",
    subject: `${labels ? "Adresnice" : "Nepotpune količine"} · ${payload.batchNumber}`, text,
    html: `<p>${escape(text).replace(/\n/g, "<br>")}</p>`, attachments,
    idempotencyKey: `picking-${payload.mode}:${payload.operationKey}`, metadata: { batchId: payload.batchId, planHash: payload.planHash } });
  if (!result.ok) throw new Error(result.error);
}
