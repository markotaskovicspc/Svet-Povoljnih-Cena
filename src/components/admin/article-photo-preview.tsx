"use client";

import Image from "next/image";
import Link from "next/link";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

export function ArticlePhotoPreview({
  src,
  previewSrc,
  href,
  name,
}: {
  src: string;
  previewSrc?: string;
  href: string;
  name: string;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger
        delay={150}
        render={<Link href={href} prefetch={false} />}
        aria-label={`Otvori fotografije artikla ${name}`}
        className="inline-flex size-12 items-center justify-center overflow-hidden rounded-md bg-muted-bg ring-1 ring-border/60 transition hover:ring-walnut/40 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Image src={src} alt="" width={48} height={48} unoptimized className="size-12 object-cover" />
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side="right" sideOffset={16} collisionPadding={16} className="z-50">
          <TooltipPrimitive.Popup className="rounded-xl border border-border bg-background p-3 shadow-2xl">
            <Image
              src={previewSrc || src}
              alt={name}
              width={440}
              height={440}
              unoptimized
              className="size-[440px] max-h-[calc(100vh-80px)] max-w-[calc(100vw-64px)] object-contain"
            />
            <p className="mt-2 max-w-[440px] truncate text-center text-sm text-ink-500">{name}</p>
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
