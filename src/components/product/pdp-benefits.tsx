import { RotateCcw, ShieldCheck, Truck } from "lucide-react";
import type { Product } from "@/types";

export function PdpBenefits({
  deliveryDays,
}: Pick<Product, "deliveryDays">) {
  const benefits = [
    {
      label: `Isporuka ${deliveryDays.min}–${deliveryDays.max} dana`,
      lines: ["Isporuka", `${deliveryDays.min} – ${deliveryDays.max} dana`],
      Icon: Truck,
    },
    {
      label: "Povrat bez stresa",
      lines: ["Povrat", "bez stresa"],
      Icon: RotateCcw,
    },
    {
      label: "Sigurna kupovina",
      lines: ["Sigurna", "kupovina"],
      Icon: ShieldCheck,
    },
  ];

  return (
    <ul
      className="border-border/60 grid grid-cols-3 gap-1.5 border-t pt-2 md:gap-2 md:pt-2.5"
      aria-label="Prednosti kupovine"
    >
      {benefits.map(({ label, lines, Icon }) => (
        <li
          key={label}
          aria-label={label}
          className="flex aspect-[2.82/1] items-center gap-[clamp(0.25rem,0.65vw,0.75rem)] rounded-[clamp(0.5rem,1vw,1rem)] border border-ink-900 bg-white px-[clamp(0.35rem,0.8vw,0.85rem)] text-ink-900 md:w-[90%] md:justify-self-center"
        >
          <Icon
            className="h-auto w-[32%] shrink-0 md:w-[35.56%]"
            strokeWidth={2.35}
            aria-hidden
          />
          <span className="flex min-w-0 flex-1 flex-col items-center text-center text-[0.55rem] leading-[1.15] font-semibold tracking-[0.02em] uppercase md:text-[clamp(0.45rem,1vw,0.9rem)]">
            <span>{lines[0]}</span>
            <span className="mt-[0.22em] whitespace-nowrap">{lines[1]}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
