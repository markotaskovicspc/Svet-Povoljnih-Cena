import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { listProducts } from "@/lib/api/catalog";

export const metadata: Metadata = {
  title: "Ograničena količina",
  description:
    "Artikli iz akcijske ponude dostupni u ograničenim količinama, dok traju zalihe.",
};

export default async function OgranicenaPonudaPage() {
  const { items: products } = await listProducts({ limitedOnly: true, limit: 300 });
  return (
    <ListingShell
      kind="akcija"
      title="Ograničena količina"
      subtitle="Ponude sa malim stanjem na lageru i jasno označenim dostupnim količinama."
      trail={[{ label: "Ograničena količina" }]}
      source={products}
    />
  );
}
