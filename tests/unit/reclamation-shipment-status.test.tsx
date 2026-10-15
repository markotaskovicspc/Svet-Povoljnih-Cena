import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ReclamationShipmentStatus } from "@/components/admin/reclamation-shipment-status";
const shipment = {
  provider: "X_EXPRESS", providerOrderId: "26-00012345", providerParcelNumbers: ["AAA0850302155"], trackingNo: "AAA0850302155", status: "OUT_FOR_DELIVERY" as const,
  providerStatusCode: "DLV_ASSIGNED", lastStatusSyncAt: new Date("2026-10-15T10:00:00Z"),
  events: [{ id: "event", status: "OUT_FOR_DELIVERY" as const, providerStatusCode: "DLV_ASSIGNED", message: null, occurredAt: new Date("2026-10-15T09:00:00Z") }],
};
it("distinguishes the courier order number from parcel numbers and translates status history", () => {
  const html = renderToStaticMarkup(<ReclamationShipmentStatus shipment={shipment} labels={new Map([["DLV_ASSIGNED", "Zaduženo za dostavu"]])} />);
  expect(html).toContain('Broj naloga: </dt><dd class="inline font-mono">26-00012345');
  expect(html).toContain('Broj paketa: </dt><dd class="inline font-mono">AAA0850302155');
  expect(html.match(/Zaduženo za dostavu/g)).toHaveLength(2);
  expect(html).toContain("Istorija statusa kurira");
});
it("does not invent an order number for a locally prepared shipment", () => {
  const html = renderToStaticMarkup(<ReclamationShipmentStatus shipment={{ ...shipment, providerOrderId:null, providerStatusCode:"LOCAL_PREPARED", events:[] }} labels={new Map()} />);
  expect(html).toContain("Kurir još nije potvrdio broj naloga");
  expect(html).toContain("Adresnica pripremljena — nije poslato");
  expect(html).not.toContain("Istorija statusa kurira");
});
it("falls back to tracking when the saved parcel array contains no valid numbers", () => {
  const html = renderToStaticMarkup(<ReclamationShipmentStatus shipment={{ ...shipment, providerParcelNumbers: [null, ""] }} labels={new Map()} />);
  expect(html).toContain('Broj paketa: </dt><dd class="inline font-mono">AAA0850302155');
});
it("shows the MyGLS event description and all parcels", () => {
  const html = renderToStaticMarkup(<ReclamationShipmentStatus shipment={{ ...shipment, provider:"MYGLS", providerParcelNumbers:["10001", "10002"], events:[{ ...shipment.events[0], message:"Predato dostavljaču" }] }} labels={new Map()} />);
  expect(html).toContain("10001, 10002");
  expect(html).toContain("Predato dostavljaču");
});
