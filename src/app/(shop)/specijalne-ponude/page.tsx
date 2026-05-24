import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { protectedPricesIcon } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";

export const metadata: Metadata = {
  title: "Trajno niskom cenom",
  description:
    "Izdvojeni proizvodi sa trajno niskom cenom.",
};

export default async function SpecijalnePonudePage() {
  const { items: products } = await listProducts({
    actionSlug: "specijalne-ponude",
    limit: 300,
  });
  return (
    <ListingShell
      kind="akcija"
      title="Trajno niskom cenom"
      titleIcon={protectedPricesIcon}
      headerVariant="promo"
      trail={[{ label: "Trajno niskom cenom" }]}
      source={products}
    />
  );
}
