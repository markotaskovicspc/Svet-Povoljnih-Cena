import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { newCampaignSticker } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";
import {
  type ListingSubTab,
  matchesListingSubTab,
} from "@/lib/listing/filters";
import { getTabTitleIcon } from "@/lib/storefront/content";

export const metadata: Metadata = {
  title: "Novo u ponudi — najnoviji proizvodi",
  description:
    "Najnoviji proizvodi u ponudi, sortirani od najnovijih ka starijima.",
};

/** Suggested room tabs; empty tabs are omitted once the full source is known. */
const ROOM_TABS: ListingSubTab[] = [
  { id: "trpezarije", label: "Trpezarije", matchKeyword: "trpezar" },
  { id: "spavace", label: "Spavaće sobe", matchKeyword: "spavać" },
  { id: "dnevne", label: "Dnevne sobe", matchKeyword: "dnevna" },
  {
    id: "stolice",
    label: "Stolice",
    matchKeyword: "stolic",
    matchField: "name",
  },
  { id: "police", label: "Police", matchKeyword: "polic", matchField: "name" },
  { id: "ormari", label: "Ormari", matchKeyword: "ormar", matchField: "name" },
];

export default async function NovoPage() {
  const query = { newOnly: true };
  const [{ items: products, nextCursor, total }, titleIcon] = await Promise.all([
    listProducts({ ...query, limit: 300 }),
    getTabTitleIcon("/novo"),
  ]);
  const sourceIsComplete = !nextCursor;
  const subTabs = sourceIsComplete
    ? ROOM_TABS.filter((tab) =>
        products.some((product) => matchesListingSubTab(product, tab)),
      )
    : ROOM_TABS;
  return (
    <ListingShell
      kind="novo"
      title="Novo u ponudi"
      titleIcon={titleIcon ?? newCampaignSticker}
      campaignSticker="new"
      subtitle="Najnoviji proizvodi u ponudi — najnoviji prvi."
      trail={[{ label: "Novo" }]}
      source={products}
      subTabs={subTabs}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
      sourceIsComplete={sourceIsComplete}
    />
  );
}
