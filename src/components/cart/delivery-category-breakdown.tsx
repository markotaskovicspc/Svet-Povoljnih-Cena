import type { PublishedDeliveryCategoryBreakdown } from "@/lib/delivery-tariff";
import { formatRsd } from "@/lib/format";

export function DeliveryCategoryBreakdown({
  breakdown,
}: {
  breakdown: PublishedDeliveryCategoryBreakdown | null;
}) {
  if (!breakdown) return null;

  const rows = ([1, 2] as const).filter(
    (category) => breakdown[category].weightKg > 0,
  );
  if (!rows.length) return null;

  return rows.map((category) => {
    const total = breakdown[category];
    return (
      <div
        key={category}
        className="flex items-baseline justify-between pl-5 text-xs text-ink-500"
      >
        <dt>
          {category === 1 ? "I" : "II"} kategorija ({formatWeight(total.weightKg)})
        </dt>
        <dd className="font-medium tabular-nums">
          {total.price === 0 ? "Besplatno" : formatRsd(total.price)}
        </dd>
      </div>
    );
  });
}

function formatWeight(weightKg: number) {
  return `${weightKg.toLocaleString("sr-Latn-RS", {
    maximumFractionDigits: 3,
  })} kg`;
}
