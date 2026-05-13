import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  className?: string;
  imageClassName?: string;
}

export function BrandLogo({ className, imageClassName }: BrandLogoProps) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <Image
        src="/brand/svet-akcija.svg"
        alt="Svet Akcija"
        width={2389}
        height={570}
        priority
        unoptimized
        className={cn("block h-auto w-full", imageClassName)}
      />
    </span>
  );
}
