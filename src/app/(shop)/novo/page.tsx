import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { newCampaignSticker } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";

export const metadata: Metadata = {
  title: "Novo u ponudi — najsvežiji komadi",
  description:
    "Najnovije pristigli komadi nameštaja. Sortirano po preostalom trajanju oznake „Novo“.",
};

/** Sub-tabs sourced from primary nav rooms. */
const ROOM_TABS = [
  { id: "trpezarije", label: "Trpezarije", matchKeyword: "trpezar" },
  { id: "spavace", label: "Spavaće sobe", matchKeyword: "spavać" },
  { id: "dnevne", label: "Dnevne sobe", matchKeyword: "dnevna" },
  { id: "stolice", label: "Stolice", matchKeyword: "stolice" },
  { id: "police", label: "Police", matchKeyword: "police" },
  { id: "ormari", label: "Ormari", matchKeyword: "ormari" },
];

export default async function NovoPage() {
  const query = { newOnly: true };
  const { items: products, nextCursor, total } = await listProducts({
    ...query,
    limit: LISTING_PAGE_SIZE,
  });
  return (
    <ListingShell
      kind="novo"
      title="Novo u ponudi"
      titleIcon={newCampaignSticker}
      campaignSticker="new"
      subtitle="Pristiglo u poslednjih 30 dana — najsvežiji komadi prvi."
      trail={[{ label: "Novo" }]}
      source={products}
      subTabs={ROOM_TABS}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
    />
  );
}
