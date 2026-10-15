import type { ReactNode } from "react";

/** The classification comes from the resolved shipment, including repeat scans. */
export function ScannedReturnPanel({ reclamationNumber, children }: {
  reclamationNumber?: string | null;
  children: ReactNode;
}) {
  return <div data-return-kind={reclamationNumber ? "reclamation" : "ordinary"} className={`mt-5 space-y-3 rounded-xl border p-4 ${reclamationNumber ? "border-amber-400 bg-amber-50 text-amber-950 [&_.text-ink-500]:text-amber-800 [&_.bg-muted]:bg-amber-100" : "border-border"}`}>
    {reclamationNumber ? <div role="alert" className="rounded-lg border border-amber-400 bg-amber-100 p-3">
      <p className="font-semibold">Povrat po reklamaciji</p>
      <p className="mt-1 text-sm">Reklamacija {reclamationNumber}. Pregledajte robu prema reklamaciji pre potvrde prijema.</p>
    </div> : null}
    {children}
  </div>;
}
