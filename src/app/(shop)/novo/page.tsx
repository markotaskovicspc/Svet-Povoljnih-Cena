import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { newCampaignSticker } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";
import { getTabTitleIcon } from "@/lib/storefront/content";

export const metadata: Metadata = {
  title: "Novo u ponudi — najnoviji proizvodi",
  description:
    "Najnoviji proizvodi u ponudi, sortirani od najnovijih ka starijima.",
};

export default async function NovoPage() {
  const query = { newOnly: true };
  const [{ items: products, nextCursor, total }, titleIcon] = await Promise.all([
    listProducts({ ...query, limit: 300 }),
    getTabTitleIcon("/novo"),
  ]);
  const sourceIsComplete = !nextCursor;
  return (
    <ListingShell
      kind="novo"
      title="Novo u ponudi"
      titleIcon={titleIcon ?? newCampaignSticker}
      campaignSticker="new"
      trail={[{ label: "Novo" }]}
      source={products}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
      sourceIsComplete={sourceIsComplete}
    />
  );
}
