import type { Metadata } from "next";
import { CartView } from "@/components/cart/cart-view";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

export const metadata: Metadata = {
  title: "Korpa",
  description:
    "Pregled artikala u korpi, ukupna ušteda i unos voucher koda pre nastavka na podatke za isporuku.",
};

export default function CartPage() {
  return (
    <div className="mx-auto max-w-[var(--container-page)] px-4 pt-4 pb-32 md:px-6 md:pt-6 md:pb-24">
      <Breadcrumbs trail={[{ label: "Korpa" }]} />
      <h1 className="font-display mt-3 text-2xl text-ink-900 md:text-4xl">
        Vaša korpa
      </h1>
      <p className="mt-1 max-w-prose text-xs text-ink-500 md:text-sm">
        Proverite stavke, unesite voucher kod i nastavite na podatke za
        isporuku.
      </p>
      <div className="mt-4 md:mt-8">
        <CartView />
      </div>
    </div>
  );
}
