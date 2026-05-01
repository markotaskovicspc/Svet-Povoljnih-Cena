import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { mockProducts } from "@/data/products";

export const metadata: Metadata = {
  title: "Novo u ponudi — najsvežiji komadi",
  description:
    "Najnovije pristigli komadi nameštaja. Sortirano po preostalom trajanju oznake „Novo“.",
};

/** Sub-tabs sourced from primary nav rooms (Phase 1 mock). */
const ROOM_TABS = [
  { id: "trpezarije", label: "Trpezarije", matchKeyword: "trpezar" },
  { id: "spavace", label: "Spavaće sobe", matchKeyword: "spavać" },
  { id: "dnevne", label: "Dnevne sobe", matchKeyword: "dnevna" },
  { id: "stolice", label: "Stolice", matchKeyword: "stolice" },
  { id: "police", label: "Police", matchKeyword: "police" },
  { id: "ormari", label: "Ormari", matchKeyword: "ormari" },
];

export default function NovoPage() {
  const products = mockProducts.filter((p) => p.isNew);
  return (
    <ListingShell
      kind="novo"
      title="Novo u ponudi"
      subtitle="Pristiglo u poslednjih 30 dana — najsvežiji komadi prvi."
      trail={[{ label: "Novo" }]}
      source={products}
      subTabs={ROOM_TABS}
    />
  );
}
