import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { akcijaIcon } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";
import { getTabTitleIcon } from "@/lib/storefront/content";
import { getMonthlyActionMetadata } from "@/lib/storefront/monthly-action-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return getMonthlyActionMetadata();
}

export default async function AkcijaPage() {
  const query = { onSaleOnly: true };
  const [{ items: products, nextCursor, total }, titleIcon] = await Promise.all([
    listProducts({ ...query, limit: LISTING_PAGE_SIZE }),
    getTabTitleIcon("/akcija"),
  ]);
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
      titleIcon={titleIcon ?? akcijaIcon}
      campaignSticker="action"
      headerVariant="promo"
      period={period ? { startsAt: period.startsAt, endsAt: period.endsAt, label: "Akcijska ponuda" } : undefined}
      periodPlacement="title-line"
      trail={[{ label: "Akcija" }]}
      source={products}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
    />
  );
}
