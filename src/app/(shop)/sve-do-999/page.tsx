import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { akcijaIcon } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";

export const metadata: Metadata = {
  title: "Sve do 999",
  description:
    "Praktični dodaci i sitnice za dom po ceni do 999 RSD.",
};

export default async function SveDo999Page() {
  const { items: products } = await listProducts({ maxPrice: 999, limit: 300 });
  return (
    <ListingShell
      kind="akcija"
      title="Sve do 999"
      titleIcon={akcijaIcon}
      headerVariant="promo"
      subtitle="Mali dodaci za dom i nameštaj u najnižem cenovnom rangu."
      trail={[{ label: "Sve do 999" }]}
      source={products}
    />
  );
}
