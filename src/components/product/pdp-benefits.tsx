import { RotateCcw, ShieldCheck, Truck } from "lucide-react";
import type { Product } from "@/types";

export function PdpBenefits({
  deliveryDays,
}: Pick<Product, "deliveryDays">) {
  const benefits = [
    {
      label: `Isporuka ${deliveryDays.min}–${deliveryDays.max} dana`,
      Icon: Truck,
    },
    { label: "Povrat bez stresa", Icon: RotateCcw },
    { label: "Sigurna kupovina", Icon: ShieldCheck },
  ];

  return (
    <ul className="border-border/60 grid grid-cols-3 gap-1 border-t pt-2 text-xs text-ink-700 md:pt-1.5">
      {benefits.map(({ label, Icon }) => (
        <li
          key={label}
          className="bg-surface ring-border/60 flex min-h-9 items-center justify-center gap-1 rounded-md p-1 text-center leading-tight ring-1 shadow-soft-1 md:h-8 md:min-h-0 md:flex-col md:gap-0 md:p-0.5"
        >
          <Icon className="size-3 text-walnut" aria-hidden />
          <span className="line-clamp-2 text-xs font-bold md:text-[10px]">
            {label}
          </span>
        </li>
      ))}
    </ul>
  );
}
