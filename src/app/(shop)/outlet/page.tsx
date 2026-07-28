import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { akcijaIcon } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";
import { getTabTitleIcon } from "@/lib/storefront/content";

export const metadata: Metadata = {
  title: "Outlet — komadi po najnižim cenama",
  description:
    "Outlet ponuda: poslednji komadi, dok traju zalihe i najveći popusti u ponudi.",
};

export default async function OutletPage() {
  const query = { outletOnly: true };
  const [{ items: products, nextCursor, total }, titleIcon] = await Promise.all([
    listProducts({ ...query, limit: LISTING_PAGE_SIZE }),
    getTabTitleIcon("/outlet"),
  ]);
  return (
    <ListingShell
      kind="outlet"
      title="Outlet"
      titleIcon={titleIcon ?? akcijaIcon}
      headerVariant="promo"
      subtitle="Poslednji komadi — dok traju zalihe."
      trail={[{ label: "Outlet" }]}
      source={products}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
    />
  );
}
