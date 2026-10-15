import type { Shipment, ShipmentEvent } from "@prisma/client";
import { SHIPMENT_STATUS_LABEL } from "@/lib/courier/status";
import { xExpressStatusDisplay } from "@/lib/x-express/status-display";

type CourierShipment = Pick<Shipment,
  "provider" | "providerOrderId" | "providerParcelNumbers" | "trackingNo" |
  "status" | "providerStatusCode" | "lastStatusSyncAt"
> & { events: Pick<ShipmentEvent, "id" | "status" | "providerStatusCode" | "message" | "occurredAt">[] };

const localLabels: Record<string, string> = {
  LOCAL_PREPARED: "Adresnica pripremljena — nije poslato",
  LOCAL_ANNOUNCING: "Slanje u toku",
  LOCAL_ANNOUNCEMENT_FAILED: "Slanje nije uspelo",
};
const date = (value: Date) => value.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" });

export function ReclamationShipmentStatus({ shipment, labels }: {
  shipment: CourierShipment;
  labels: ReadonlyMap<string, string>;
}) {
  const parcels = Array.isArray(shipment.providerParcelNumbers)
    ? shipment.providerParcelNumbers.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  const currentEvent = shipment.events.find(event => event.providerStatusCode === shipment.providerStatusCode);
  const statusLabel = localLabels[shipment.providerStatusCode ?? ""] || (shipment.provider === "X_EXPRESS"
    ? xExpressStatusDisplay({ ...shipment, dictionaryLabel: labels.get(shipment.providerStatusCode ?? ""), message: currentEvent?.message }).label
    : currentEvent?.message || shipment.providerStatusCode || SHIPMENT_STATUS_LABEL[shipment.status]);

  return <>
    <dl className="mt-2 space-y-1 break-words">
      <div><dt className="inline text-ink-500">Broj naloga: </dt><dd className="inline font-mono">{shipment.providerOrderId || "Kurir još nije potvrdio broj naloga"}</dd></div>
      <div><dt className="inline text-ink-500">Broj paketa: </dt><dd className="inline font-mono">{parcels.length ? parcels.join(", ") : shipment.trackingNo || "—"}</dd></div>
      <div><dt className="inline text-ink-500">Status kurira: </dt><dd className="inline">{statusLabel}</dd></div>
      <div><dt className="inline text-ink-500">Poslednja provera: </dt><dd className="inline">{shipment.lastStatusSyncAt ? date(shipment.lastStatusSyncAt) : "—"}</dd></div>
    </dl>
    {shipment.events.length ? <details className="mt-3">
      <summary className="cursor-pointer font-medium">Istorija statusa kurira</summary>
      <ol className="mt-2 space-y-2">{shipment.events.map(event => <li key={event.id}>
        <time dateTime={event.occurredAt.toISOString()}>{date(event.occurredAt)}</time> · {shipment.provider === "X_EXPRESS"
          ? localLabels[event.providerStatusCode ?? ""] || xExpressStatusDisplay({ ...event, dictionaryLabel: labels.get(event.providerStatusCode ?? "") }).label
          : event.message || event.providerStatusCode || SHIPMENT_STATUS_LABEL[event.status]}
      </li>)}</ol>
    </details> : null}
  </>;
}
