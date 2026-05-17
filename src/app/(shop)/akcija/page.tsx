import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { listProducts } from "@/lib/api/catalog";
import { getSectionBanner } from "@/lib/storefront/content";

export const metadata: Metadata = {
  title: "Akcija — kuratirana selekcija po sniženim cenama",
  description:
    "Aktuelna akcijska ponuda nameštaja. Heroji meseca, najveći popusti i najpovoljnije cene na jednom mestu.",
};

export default async function AkcijaPage() {
  const [{ items: products }, banner] = await Promise.all([
    listProducts({ onSaleOnly: true, limit: 300 }),
    getSectionBanner("mesecna-akcija"),
  ]);
  // Pick the action that ends latest (umbrella period banner).
  const period = products
    .map((p) => p.action!)
    .filter((action) => !action.isPermanent)
    .sort(
      (a, b) =>
        new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime(),
    )[0];

  return (
    <ListingShell
      kind="akcija"
      title="Akcija"
      subtitle="Sve aktivne ponude na jednom mestu — kuratirano, ne agregirano."
      period={period ? { endsAt: period.endsAt, label: "Akcijska ponuda" } : undefined}
      trail={[{ label: "Akcija" }]}
      source={products}
      featureBanner={banner ?? undefined}
      featureBannerMobileOnly
    />
  );
}
