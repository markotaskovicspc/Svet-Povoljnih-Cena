import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { mockProducts } from "@/data/products";

export const metadata: Metadata = {
  title: "Outlet — komadi po najnižim cenama",
  description:
    "Outlet ponuda: ograničene količine, dok traju zalihe i najveći popusti u ponudi.",
};

/** Outlet rule (Phase 1): ograničene količine ili "dok traju zalihe", ili popust ≥ 25%. */
const isOutlet = (p: { isLimited?: boolean; isDtz?: boolean; discountPct?: number }) =>
  !!p.isLimited || !!p.isDtz || (p.discountPct ?? 0) >= 25;

export default function OutletPage() {
  const products = mockProducts.filter(isOutlet);
  return (
    <ListingShell
      kind="outlet"
      title="Outlet"
      subtitle="Ograničene količine i poslednji komadi — dok traju zalihe."
      trail={[{ label: "Outlet" }]}
      source={products}
    />
  );
}
