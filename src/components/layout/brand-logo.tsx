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
        src="/logo.webp"
        alt={BRAND.name}
        width={1600}
        height={382}
        priority
        className={cn("block h-auto w-full", imageClassName)}
      />
    </span>
  );
}
