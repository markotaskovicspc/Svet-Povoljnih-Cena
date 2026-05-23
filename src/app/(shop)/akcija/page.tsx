import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { akcijaIcon } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";

export const metadata: Metadata = {
  title: "Mesečna akcija — kuratirana selekcija po sniženim cenama",
  description:
    "Aktuelna akcijska ponuda nameštaja. Heroji meseca, najveći popusti i najpovoljnije cene na jednom mestu.",
};

export default async function AkcijaPage() {
  const { items: products } = await listProducts({ onSaleOnly: true, limit: 300 });
  // Pick the action that ends latest (umbrella period banner).
  const period = products
    .flatMap((p) => (p.action && !p.action.isPermanent ? [p.action] : []))
    .sort(
      (a, b) =>
        new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime(),
    )[0];

  return (
    <ListingShell
      kind="akcija"
      title="Akcija"
      titleIcon={akcijaIcon}
      campaignSticker="action"
      headerVariant="promo"
      subtitle="Sve aktivne ponude na jednom mestu — kuratirano, ne agregirano."
      period={period ? { endsAt: period.endsAt, label: "Akcijska ponuda" } : undefined}
      trail={[{ label: "Akcija" }]}
      source={products}
    />
  );
}
