import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { listProducts } from "@/lib/api/catalog";
import { getSectionBanner } from "@/lib/storefront/content";

export const metadata: Metadata = {
  title: "Mesečna akcija — kuratirana selekcija po sniženim cenama",
  description:
    "Aktuelna akcijska ponuda nameštaja. Heroji meseca, najveći popusti i najpovoljnije cene na jednom mestu.",
};

export default async function AkcijaPage() {
  const [{ items: products }, banner] = await Promise.all([
    listProducts({ onSaleOnly: true, limit: 300 }),
    getSectionBanner("mesecna-akcija"),
  ]);

  return (
    <ListingShell
      kind="akcija"
      title="Mesečna akcija"
      trail={[{ label: "Mesečna akcija" }]}
      source={products}
      featureBanner={banner ?? undefined}
    />
  );
}
