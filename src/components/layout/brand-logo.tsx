import Image from "next/image";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  className?: string;
  imageClassName?: string;
}

export function BrandLogo({ className, imageClassName }: BrandLogoProps) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <Image
        src="/logo.svg"
        alt={BRAND.name}
        width={1193}
        height={198}
        preload
        className={cn("block h-auto w-full", imageClassName)}
      />
    </span>
  );
}
