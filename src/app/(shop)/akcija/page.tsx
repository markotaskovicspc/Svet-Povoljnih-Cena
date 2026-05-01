import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { mockProducts } from "@/data/products";

export const metadata: Metadata = {
  title: "Akcija — kuratirana selekcija po sniženim cenama",
  description:
    "Aktuelna akcijska ponuda nameštaja. Heroji meseca, najveći popusti i najpovoljnije cene na jednom mestu.",
};

export default function AkcijaPage() {
  const products = mockProducts.filter((p) => !!p.action);
  // Pick the action that ends latest (umbrella period banner).
  const period = products
    .map((p) => p.action!)
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
    />
  );
}
