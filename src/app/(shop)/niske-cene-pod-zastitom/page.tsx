import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { protectedPricesIcon } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";

export const metadata: Metadata = {
  title: "Niske cene pod trajnom zaštitom",
  description:
    "Trajno zaštićene akcijske cene uvedene od 01.05.2026. u skladu sa promenama Zakona o trgovini.",
};

export default async function NiskeCenePodZastitomPage() {
  const query = { actionSlug: "niske-cene-pod-zastitom" };
  const { items: products, nextCursor, total } = await listProducts({
    ...query,
    limit: LISTING_PAGE_SIZE,
  });

  return (
    <ListingShell
      kind="niske-cene-pod-zastitom"
      title="Niske cene pod trajnom zaštitom"
      titleIcon={protectedPricesIcon}
      headerVariant="promo"
      trail={[{ label: "Niske cene pod trajnom zaštitom" }]}
      source={products}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
    />
  );
}
