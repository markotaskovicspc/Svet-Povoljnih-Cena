import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { WishlistView } from "@/components/cart/wishlist-view";

export const metadata: Metadata = {
  title: "Lista želja",
  description:
    "Vaša sačuvana lista omiljenih proizvoda sa obaveštenjima kada budu na akciji ili na stanju.",
};

export default function WishlistPage() {
  return (
    <div className="mx-auto max-w-[var(--container-page)] px-4 pt-6 pb-24 md:px-6">
      <Breadcrumbs
        trail={[{ label: "Nalog", href: "/nalog" }, { label: "Lista želja" }]}
      />
      <h1 className="font-display mt-3 text-3xl text-ink-900 md:text-4xl">
        Lista želja
      </h1>
      <p className="mt-1 max-w-prose text-sm text-ink-500">
        Sačuvajte komade koji su vam zapali za oko i primajte obaveštenja kada
        budu na akciji ili ponovo na stanju.
      </p>
      <div className="mt-8">
        <WishlistView />
      </div>
    </div>
  );
}
