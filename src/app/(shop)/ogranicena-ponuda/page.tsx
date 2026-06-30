import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { limitedCampaignSticker } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";

export const metadata: Metadata = {
  title: "Dok traju zalihe",
  description:
    "Artikli iz akcijske ponude dostupni dok traju zalihe.",
};

export default async function OgranicenaPonudaPage() {
  const query = { limitedOnly: true };
  const { items: products, nextCursor, total } = await listProducts({
    ...query,
    limitedOnly: true,
    limit: LISTING_PAGE_SIZE,
  });
  return (
    <ListingShell
      kind="akcija"
      title="Dok traju zalihe"
      titleIcon={limitedCampaignSticker}
      campaignSticker="limited"
      headerVariant="promo"
      trail={[{ label: "Dok traju zalihe" }]}
      source={products}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
    />
  );
}
