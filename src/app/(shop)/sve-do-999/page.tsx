import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { listProducts } from "@/lib/api/catalog";
import { getSectionBanner } from "@/lib/storefront/content";

export const metadata: Metadata = {
  title: "Sve do 999",
  description:
    "Praktični dodaci i sitnice za dom po ceni do 999 RSD.",
};

export default async function SveDo999Page() {
  const [{ items: products }, banner] = await Promise.all([
    listProducts({ maxPrice: 999, limit: 300 }),
    getSectionBanner("sve-do-999"),
  ]);
  return (
    <ListingShell
      kind="akcija"
      title="Sve do 999"
      trail={[{ label: "Sve do 999" }]}
      source={products}
      featureBanner={banner ?? undefined}
    />
  );
}
