import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { limitedOffer } from "@/data/products";

export const metadata: Metadata = {
  title: "Ograničena količina",
  description:
    "Artikli iz akcijske ponude dostupni u ograničenim količinama, dok traju zalihe.",
};

export default function OgranicenaPonudaPage() {
  return (
    <ListingShell
      kind="akcija"
      title="Ograničena količina"
      subtitle="Ponude sa malim stanjem na lageru i jasno označenim dostupnim količinama."
      trail={[{ label: "Ograničena količina" }]}
      source={limitedOffer()}
    />
  );
}
