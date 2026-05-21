import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { akcijaIcon } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";

export const metadata: Metadata = {
  title: "Dok traju zalihe",
  description:
    "Artikli iz akcijske ponude dostupni dok traju zalihe.",
};

export default async function OgranicenaPonudaPage() {
  const { items: products } = await listProducts({
    limitedOnly: true,
    limit: 300,
  });
  return (
    <ListingShell
      kind="akcija"
      title="Dok traju zalihe"
      titleIcon={akcijaIcon}
      headerVariant="promo"
      subtitle="Ponude sa malim stanjem na lageru i jasno označenim dostupnim količinama."
      trail={[{ label: "Dok traju zalihe" }]}
      source={products}
    />
  );
}
