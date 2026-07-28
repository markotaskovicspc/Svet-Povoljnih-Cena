import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { protectedPricesIcon } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";
import { getTabTitleIcon } from "@/lib/storefront/content";

export const metadata: Metadata = {
  title: "Trajno niskom cenom",
  description:
    "Izdvojeni proizvodi sa trajno niskom cenom.",
};

export default async function SpecijalnePonudePage() {
  const query = { actionSlug: "specijalne-ponude" };
  const [{ items: products, nextCursor, total }, titleIcon] = await Promise.all([
    listProducts({ ...query, limit: LISTING_PAGE_SIZE }),
    getTabTitleIcon("/specijalne-ponude"),
  ]);
  return (
    <ListingShell
      kind="akcija"
      title="Trajno niskom cenom"
      titleIcon={titleIcon ?? protectedPricesIcon}
      headerVariant="promo"
      trail={[{ label: "Trajno niskom cenom" }]}
      source={products}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
    />
  );
}
