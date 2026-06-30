import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { akcijaIcon } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";

export const metadata: Metadata = {
  title: "Nedeljna akcija — sedam dana posebnih ponuda",
  description:
    "Brze nedeljne ponude koje se menjaju svake nedelje. Iskoristi dok traju — popusti važe sedam dana.",
};

export default async function NedeljnaAkcijaPage() {
  const query = { actionSlug: "nedeljna-akcija" };
  const { items: products, nextCursor, total } = await listProducts({
    ...query,
    limit: LISTING_PAGE_SIZE,
  });
  const period = products
    .flatMap((p) => (p.action ? [p.action] : []))
    .sort(
      (a, b) =>
        new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime(),
    )[0];

  return (
    <ListingShell
      kind="nedeljna-akcija"
      title="Nedeljna akcija"
      titleIcon={akcijaIcon}
      campaignSticker="action"
      headerVariant="promo"
      subtitle="Selekcija sedam dana — najatraktivnije ponude nedelje."
      period={
        period ? { endsAt: period.endsAt, label: "Nedeljna ponuda" } : undefined
      }
      trail={[{ label: "Nedeljna akcija" }]}
      source={products}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
    />
  );
}
