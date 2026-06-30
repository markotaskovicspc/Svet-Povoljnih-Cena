import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { under999CampaignSticker } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";

export const metadata: Metadata = {
  title: "Sve do 999",
  description:
    "Praktični dodaci i sitnice za dom po ceni do 999 RSD.",
};

export default async function SveDo999Page() {
  const query = { maxPrice: 999 };
  const { items: products, nextCursor, total } = await listProducts({
    ...query,
    limit: LISTING_PAGE_SIZE,
  });
  return (
    <ListingShell
      kind="akcija"
      title="Sve do 999"
      titleIcon={under999CampaignSticker}
      campaignSticker="under999"
      headerVariant="promo"
      subtitle="Mali dodaci za dom i nameštaj u najnižem cenovnom rangu."
      trail={[{ label: "Sve do 999" }]}
      source={products}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
    />
  );
}
