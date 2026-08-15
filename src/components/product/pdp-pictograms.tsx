import Image from "next/image";
import type { Pictogram } from "@/types";
import { cn } from "@/lib/utils";

export function PdpPictograms({
  pictograms,
  className,
}: {
  pictograms: Pictogram[];
  className?: string;
}) {
  const visible = pictograms.slice(0, 6);
  if (!visible.length) return null;

  return (
    <ul
      className={cn(
        "pointer-events-none flex flex-col items-start gap-1.5",
        className,
      )}
      aria-label="Karakteristike proizvoda"
    >
      {visible.map((pictogram) => (
        <li
          key={pictogram.code}
          title={pictogram.label}
          className="relative size-11 overflow-hidden rounded-full bg-white/90 shadow-soft-1 ring-1 ring-white/80"
        >
          <Image
            src={pictogram.iconUrl}
            alt=""
            width={72}
            height={72}
            sizes="44px"
            className="size-full object-contain p-0.5"
          />
          <span className="sr-only">{pictogram.label}</span>
        </li>
      ))}
    </ul>
  );
}
