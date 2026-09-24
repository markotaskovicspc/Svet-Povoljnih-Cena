"use client";

import { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, ShoppingBag } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useCart } from "@/lib/hooks/use-cart";
import { useCartUi } from "@/lib/hooks/use-cart-ui";
import { formatRsd } from "@/lib/format";

export function AddToCartConfirmation() {
  const added = useCartUi((state) => state.addedItem);
  const close = useCartUi((state) => state.closeAddedItem);
  const lines = useCart((state) => state.lines);
  const heading = useRef<HTMLDivElement>(null);
  const line = lines.find((item) => item.sku === added?.line.sku) ?? added?.line;
  const count = lines.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = lines.reduce((sum, item) => sum + item.unitPriceSale * item.qty, 0);

  return <Dialog open={Boolean(added && line)} onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent data-testid="add-to-cart-confirmation" initialFocus={heading} closeLabel="Zatvori potvrdu dodavanja" className="gap-0 overflow-hidden rounded-2xl bg-surface p-0 shadow-soft-3 sm:max-w-[600px]" closeButtonClassName="top-4 right-4 size-10 rounded-full">
      <DialogHeader ref={heading} tabIndex={-1} className="border-b border-border/60 px-5 py-6 pr-16 outline-none sm:px-7 sm:pr-16">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success/10 text-success"><Check className="size-5" strokeWidth={2.5} aria-hidden /></span>
          <div><DialogTitle className="font-display text-lg leading-tight text-ink-900 sm:text-xl">Proizvod je dodat u korpu</DialogTitle><DialogDescription className="mt-1 text-xs text-ink-500 sm:text-sm">Još korak bliže dobroj kupovini.</DialogDescription></div>
        </div>
      </DialogHeader>
      {line && added && <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto overscroll-contain px-5 pt-5 pb-6 sm:px-7 sm:pt-6 sm:pb-7">
        <div className="flex items-center gap-4 sm:gap-5">
          <div className="relative size-24 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-border/60 sm:size-32">
            {line.thumbnailUrl ? <Image src={line.thumbnailUrl} alt={line.name} fill sizes="128px" className="object-contain p-2" /> : <ShoppingBag className="absolute inset-0 m-auto size-10 text-ink-500" aria-hidden />}
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold leading-snug text-ink-900 sm:text-lg">{line.name}</p>
            {line.variant && <p className="mt-1 text-sm text-ink-500">{line.variant}</p>}
            <p className="mt-2 text-sm text-ink-500">{added.addedQty > 0 ? `Dodato: ${added.addedQty} kom.` : `U korpi: ${line.qty} kom.`}</p>
            <p className="mt-1 text-lg font-semibold text-ink-900">{formatRsd(line.unitPriceSale)} <span className="text-xs font-normal text-ink-500">/ kom.</span></p>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-between gap-4 rounded-xl bg-muted-bg px-4 py-3 text-sm">
          <span className="text-ink-700">Artikli u korpi <span className="ml-1 text-ink-500">({count})</span></span>
          <span className="font-semibold text-ink-900">{formatRsd(subtotal)}</span>
        </div>
        <p className="mt-2 text-xs text-ink-500">Dostavu i dostupne popuste proverite u korpi.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Link href="/korpa" onClick={close} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-canvas transition hover:bg-walnut focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900 sm:order-2">Idi u korpu<ArrowRight className="size-4" aria-hidden /></Link>
          <button type="button" onClick={close} className="inline-flex min-h-12 items-center justify-center rounded-full border border-border px-5 py-3 text-sm font-semibold text-ink-900 transition hover:bg-muted-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900 sm:order-1">Nastavi kupovinu</button>
        </div>
      </div>}
    </DialogContent>
  </Dialog>;
}
