import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { akcijaIcon } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";

export const metadata: Metadata = {
  title: "Specijalne ponude",
  description:
    "Posebne kampanje, kratke akcije i izdvojene ponude van mesečne i nedeljne akcije.",
};

export default async function SpecijalnePonudePage() {
  const { items: products } = await listProducts({
    actionSlug: "specijalne-ponude",
    limit: 300,
  });
  return (
    <ListingShell
      kind="akcija"
      title="Specijalne ponude"
      titleIcon={akcijaIcon}
      headerVariant="promo"
      subtitle="Izdvojene kampanje i posebni popusti koji se menjaju po sezoni."
      trail={[{ label: "Specijalne ponude" }]}
      source={products}
    />
  );
}
