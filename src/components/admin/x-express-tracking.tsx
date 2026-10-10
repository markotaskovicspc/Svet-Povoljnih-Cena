import type { ShipmentStatus } from "@prisma/client";
import { Card, CardTitle } from "@/components/admin/card";
import { xExpressStatusDisplay } from "@/lib/x-express/status-display";

type TrackingEvent = {
  id: string;
  status: ShipmentStatus;
  providerStatusCode: string | null;
  message: string | null;
  occurredAt: Date;
};

type TrackingShipment = {
  id: string;
  trackingNo: string | null;
  status: ShipmentStatus;
  providerStatusCode: string | null;
  lastStatusEventAt: Date | null;
  events: TrackingEvent[];
  reshipment?: unknown;
};

function formatTime(value: Date) {
  return value.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" });
}

export function XExpressTracking({ shipments, labels }: {
  shipments: TrackingShipment[];
  labels: ReadonlyMap<string, string>;
}) {
  if (!shipments.length) return null;
  return (
    <Card id="x-express-tracking">
      <CardTitle>X Express — praćenje pošiljke</CardTitle>
      <p className="mb-3 text-sm text-ink-500">
        Statusi koje je kurir prosledio. Vreme je prikazano za Srbiju.
      </p>
      <div className="space-y-4">
        {shipments.map((shipment) => {
          const current = xExpressStatusDisplay({
            ...shipment,
            dictionaryLabel: labels.get(shipment.providerStatusCode ?? ""),
          });
          const events = [...shipment.events].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
          return (
            <section key={shipment.id} className="space-y-3">
              <div className={current.attention
                ? "rounded-lg border border-red-300 bg-red-50 p-3 text-red-800"
                : "rounded-lg border border-border p-3 text-ink-700"}>
                <p className="text-sm">Pošiljka {shipment.trackingNo ?? "bez broja"}{shipment.reshipment ? " · prethodna pošiljka / očekivani povrat" : ""}</p>
                <p className="font-semibold">{current.label}</p>
                {current.attention ? <p className="text-sm">Potrebna je provera sa kurirom.</p> : null}
                {shipment.lastStatusEventAt ? <p className="mt-1 text-xs">Poslednji status kurira: {formatTime(shipment.lastStatusEventAt)}</p> : null}
              </div>
              <ul className="space-y-2 text-sm">
                {events.map((event) => {
                  const display = xExpressStatusDisplay({
                    ...event, dictionaryLabel: labels.get(event.providerStatusCode ?? ""),
                  });
                  return (
                    <li key={event.id} className={display.attention ? "text-red-700" : "text-ink-700"}>
                      <time dateTime={event.occurredAt.toISOString()} className="mr-3 font-mono text-xs">{formatTime(event.occurredAt)}</time>
                      <span className="font-medium">{display.label}</span>
                      {event.providerStatusCode ? <span className="ml-2 text-xs text-ink-500">({event.providerStatusCode})</span> : null}
                    </li>
                  );
                })}
                {!events.length ? <li className="text-ink-500">Kurir još nije prosledio događaje.</li> : null}
              </ul>
            </section>
          );
        })}
      </div>
    </Card>
  );
}
