import type { ReclamationHistoryEntry } from "@/lib/reclamation-options";

const STATUS_LABELS = {
  PRIMLJENO: "Primljeno",
  U_OBRADI: "U obradi",
  RESENO: "Rešeno",
  ODBIJENO: "Odbijeno",
};

export function ReclamationHistory({ entries }: { entries: ReclamationHistoryEntry[] }) {
  if (!entries.length) return null;
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm" data-testid="reclamation-history">
      <p role="status">
        Za ovaj artikal već postoje reklamacije. Možete podneti novu prijavu,
        uključujući prijavu za isti komad.
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer font-medium">
          Prethodne reklamacije ({entries.length})
        </summary>
        <ul className="mt-2 space-y-2">
          {entries.map((entry) => (
            <li key={entry.number}>
              <span className="font-mono">{entry.number}</span>
              {" · "}{new Date(entry.createdAt).toLocaleDateString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })}
              {" · "}{entry.quantity} kom · {STATUS_LABELS[entry.status]}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
