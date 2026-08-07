import Image from "next/image";
import type { Pictogram } from "@/types";

export function PdpPictograms({ pictograms }: { pictograms: Pictogram[] }) {
  const visible = pictograms.slice(0, 6);
  if (!visible.length) return null;

  return (
    <ul
      className="grid grid-cols-3 gap-2 py-1 sm:grid-cols-6 md:grid-cols-3 lg:grid-cols-6"
      aria-label="Karakteristike proizvoda"
    >
      {visible.map((pictogram) => (
        <li
          key={pictogram.code}
          className="flex min-w-0 flex-col items-center gap-1 text-center"
        >
          <Image
            src={pictogram.iconUrl}
            alt=""
            width={72}
            height={72}
            className="size-12 object-contain md:size-14"
          />
          <span className="text-[10px] leading-tight font-semibold text-ink-700">
            {pictogram.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
