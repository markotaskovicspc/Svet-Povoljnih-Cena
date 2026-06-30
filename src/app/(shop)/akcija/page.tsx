import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { akcijaIcon } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";

export const metadata: Metadata = {
  title: "Mesečna akcija — kuratirana selekcija po sniženim cenama",
  description:
    "Aktuelna akcijska ponuda nameštaja. Heroji meseca, najveći popusti i najpovoljnije cene na jednom mestu.",
};

export default async function AkcijaPage() {
  const query = { onSaleOnly: true };
  const { items: products, nextCursor, total } = await listProducts({
    ...query,
    limit: LISTING_PAGE_SIZE,
  });
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
      periodPlacement="title-line"
      trail={[{ label: "Akcija" }]}
      source={products}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
    />
  );
}
