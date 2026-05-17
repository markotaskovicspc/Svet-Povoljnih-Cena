import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { listProducts } from "@/lib/api/catalog";
import { getSectionBanner } from "@/lib/storefront/content";

export const metadata: Metadata = {
  title: "Ograničena količina",
  description:
    "Artikli iz akcijske ponude dostupni u ograničenim količinama, dok traju zalihe.",
};

export default async function OgranicenaPonudaPage() {
  const [{ items: products }, banner] = await Promise.all([
    listProducts({ limitedOnly: true, limit: 300 }),
    getSectionBanner("ogranicena-ponuda"),
  ]);
  return (
    <ListingShell
      kind="akcija"
      title="Ograničena količina"
      trail={[{ label: "Ograničena količina" }]}
      source={products}
      featureBanner={banner ?? undefined}
    />
  );
}
