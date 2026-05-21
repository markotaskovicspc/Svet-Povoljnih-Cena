import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { akcijaIcon } from "@/data/campaign-icons";
import { listProducts } from "@/lib/api/catalog";

export const metadata: Metadata = {
  title: "Outlet — komadi po najnižim cenama",
  description:
    "Outlet ponuda: poslednji komadi, dok traju zalihe i najveći popusti u ponudi.",
};

export default async function OutletPage() {
  const { items: products } = await listProducts({ outletOnly: true, limit: 300 });
  return (
    <ListingShell
      kind="outlet"
      title="Outlet"
      titleIcon={akcijaIcon}
      headerVariant="promo"
      subtitle="Poslednji komadi — dok traju zalihe."
      trail={[{ label: "Outlet" }]}
      source={products}
    />
  );
}
