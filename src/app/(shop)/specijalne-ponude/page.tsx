import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { protectedPricesIcon } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";

export const metadata: Metadata = {
  title: "Trajno niskom cenom",
  description:
    "Izdvojeni proizvodi sa trajno niskom cenom.",
};

export default async function SpecijalnePonudePage() {
  const query = { actionSlug: "specijalne-ponude" };
  const { items: products, nextCursor, total } = await listProducts({
    ...query,
    limit: LISTING_PAGE_SIZE,
  });
  return (
    <ListingShell
      kind="akcija"
      title="Trajno niskom cenom"
      titleIcon={protectedPricesIcon}
      headerVariant="promo"
      trail={[{ label: "Trajno niskom cenom" }]}
      source={products}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
    />
  );
}
