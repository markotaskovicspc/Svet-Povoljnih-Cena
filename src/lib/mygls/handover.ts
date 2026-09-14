import type { PackageHandoverReport } from "@/lib/courier/package-handover";
import { isMyGlsNotification } from "./status";
import type { MyGlsStatusEvent } from "./types";

const PROOF = new Set(["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED"]);

export function buildMyGlsHandover(numbers: number[], events: MyGlsStatusEvent[]) {
  const expected = [...new Set(numbers)];
  if (!expected.length || expected.length !== numbers.length) throw new Error("MyGLS brojevi paketa nisu jedinstveni.");
  const parcels = expected.map(parcelNumber => {
    const history = events.filter(event => event.parcelNumber === parcelNumber && !isMyGlsNotification(event.providerStatusCode));
    if (!history.length || history.some(event => !event.occurredAt)) {
      throw new Error(`MyGLS nije vratio potpun datiran status za paket ${parcelNumber}.`);
    }
    const proof = history.filter(event => PROOF.has(event.status))
      .sort((a, b) => a.occurredAt!.getTime() - b.occurredAt!.getTime())[0];
    return { parcelNumber, pickedUpAt: proof?.occurredAt?.toISOString() ?? null };
  });
  const recordedAt = new Date(Math.max(...events
    .filter(event => expected.includes(event.parcelNumber) && !isMyGlsNotification(event.providerStatusCode))
    .map(event => event.occurredAt!.getTime()))).toISOString();
  return { version: 1 as const, recordedAt, parcels };
}

export type MyGlsHandover = ReturnType<typeof buildMyGlsHandover>;

export function myGlsHandoverReport(snapshot: MyGlsHandover): PackageHandoverReport {
  const picked = snapshot.parcels.filter(parcel => parcel.pickedUpAt).map(parcel => parcel.parcelNumber);
  const waiting = snapshot.parcels.filter(parcel => !parcel.pickedUpAt).map(parcel => parcel.parcelNumber);
  return {
    version: 1, source: "MYGLS", recordedAt: snapshot.recordedAt,
    expectedPackages: snapshot.parcels.length, pickedUpPackages: picked.length,
    note: [picked.length ? `GLS potvrđuje preuzimanje: ${picked.join(", ")}.` : "GLS još nije potvrdio preuzimanje.",
      waiting.length ? `Čekaju preuzimanje: ${waiting.join(", ")}.` : ""].filter(Boolean).join(" "),
  };
}
