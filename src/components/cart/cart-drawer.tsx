"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useCart } from "@/lib/hooks/use-cart";
import { useCartUi } from "@/lib/hooks/use-cart-ui";
import { formatRsd } from "@/lib/format";
import { CartLineRow } from "./cart-line-row";

/**
 * Mini-cart drawer (1F.2). Mounted globally; opens via `useCartUi`.
 */
export function CartDrawer() {
  const open = useCartUi((s) => s.drawerOpen);
  const setOpen = useCartUi((s) => s.setDrawer);
  const close = useCartUi((s) => s.closeDrawer);
  const openSuggestion = useCartUi((s) => s.openSuggestion);

  const lines = useCart((s) => s.lines);
  const subtotal = lines.reduce((n, l) => n + l.unitPriceSale * l.qty, 0);
  const savings = lines.reduce(
    (n, l) => n + (l.unitPriceFull - l.unitPriceSale) * l.qty,
    0,
  );
  const count = lines.reduce((n, l) => n + l.qty, 0);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="bg-canvas data-[side=right]:sm:max-w-md flex w-full flex-col"
      >
        <SheetHeader className="border-border/60 border-b">
          <SheetTitle className="font-display text-xl text-ink-900">
            Korpa
            {count ? (
              <span className="ml-2 text-sm font-normal text-ink-500">
                ({count})
              </span>
            ) : null}
          </SheetTitle>
          <SheetDescription className="text-ink-500">
            {count
              ? "Pregledajte stavke i nastavite na plaćanje."
              : "Vaša korpa je trenutno prazna."}
          </SheetDescription>
        </SheetHeader>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="bg-muted-bg text-ink-500 inline-flex size-14 items-center justify-center rounded-full">
              <ShoppingBag className="size-6" aria-hidden />
            </span>
            <p className="text-sm text-ink-700">Još uvek nema artikala u korpi.</p>
            <Link
              href="/akcija"
              onClick={close}
              className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 mt-2 inline-flex items-center rounded-full px-4 py-2 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
            >
              Pogledaj akciju
            </Link>
          </div>
        ) : (
          <div className="divide-border/60 flex-1 divide-y overflow-y-auto px-4">
            {lines.map((l) => (
              <CartLineRow key={l.sku} line={l} onNavigate={close} />
            ))}
          </div>
        )}

        {lines.length > 0 ? (
          <div className="border-border/60 bg-surface mt-auto flex flex-col gap-3 border-t p-4">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-ink-700">Međuzbir</span>
              <span className="font-semibold text-ink-900">
                {formatRsd(subtotal)}
              </span>
            </div>
            {savings > 0 ? (
              <div className="text-action flex items-baseline justify-between text-xs">
                <span>Vaša ušteda</span>
                <span className="font-semibold">{formatRsd(savings)}</span>
              </div>
            ) : null}
            <p className="text-[11px] text-ink-500">
              Trošak isporuke se obračunava u sledećem koraku.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href="/korpa"
                onClick={(e) => {
                  e.preventDefault();
                  close();
                  openSuggestion("/korpa");
                }}
                className="ring-border/60 hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex flex-1 items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none"
              >
                Pregled korpe
              </Link>
              <Link
                href="/checkout"
                onClick={(e) => {
                  e.preventDefault();
                  close();
                  openSuggestion("/checkout");
                }}
                className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex flex-1 items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
              >
                Plati
              </Link>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
