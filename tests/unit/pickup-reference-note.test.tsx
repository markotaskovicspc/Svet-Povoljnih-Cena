import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickupReferenceNote } from "@/components/admin/pickup-reference-note";
import { isCancelledDelivery } from "@/lib/courier/cancelled-delivery";

it("links known pickup references in notes and keeps unresolved references as text", () => {
  const html = renderToStaticMarkup(<PickupReferenceNote note="Nalog PRE-2026-0052 proknjižen. PRE-2026-0099 <script>" batches={[{ id: "batch-52", number: "PRE-2026-0052" }]} />);
  expect(html).toContain('href="/admin/erp/preuzimanja/batch-52"');
  expect(html).toContain("PRE-2026-0099 &lt;script&gt;");
  expect(html.match(/<a /g)).toHaveLength(1);
});
it("stops cancelled outgoing goods without blocking returns", () => {
  expect(isCancelledDelivery({ purpose: "ORDER_DELIVERY", order: { status: "OTKAZANO" } })).toBe(true);
  expect(isCancelledDelivery({ purpose: "ORDER_DELIVERY", order: { status: "U_PRIPREMI", cancelledAt: new Date() } })).toBe(true);
  expect(isCancelledDelivery({ purpose: "ORDER_DELIVERY", order: { status: "U_PRIPREMI" } })).toBe(false);
  expect(isCancelledDelivery({ purpose: "RECLAMATION_RETURN", order: { status: "OTKAZANO" } })).toBe(false);
});
