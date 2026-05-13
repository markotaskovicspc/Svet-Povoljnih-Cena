import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { specialOffers } from "@/data/products";

export const metadata: Metadata = {
  title: "Specijalne ponude",
  description:
    "Posebne kampanje, kratke akcije i izdvojene ponude van mesečne i nedeljne akcije.",
};

export default function SpecijalnePonudePage() {
  return (
    <ListingShell
      kind="akcija"
      title="Specijalne ponude"
      subtitle="Izdvojene kampanje i posebni popusti koji se menjaju po sezoni."
      trail={[{ label: "Specijalne ponude" }]}
      source={specialOffers()}
    />
  );
}
