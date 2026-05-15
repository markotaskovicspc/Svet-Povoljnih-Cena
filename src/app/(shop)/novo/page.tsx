import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { listProducts } from "@/lib/api/catalog";

export const metadata: Metadata = {
  title: "Novo u ponudi — najsvežiji komadi",
  description:
    "Najnovije pristigli komadi nameštaja. Sortirano po preostalom trajanju oznake „Novo“.",
};

/** Sub-tabs sourced from primary nav rooms. */
const ROOM_TABS = [
  { id: "trpezarije", label: "Trpezarije", matchKeyword: "trpezar" },
  { id: "spavace", label: "Spavaće sobe", matchKeyword: "spavać" },
  { id: "dnevne", label: "Dnevne sobe", matchKeyword: "dnevna" },
  { id: "stolice", label: "Stolice", matchKeyword: "stolice" },
  { id: "police", label: "Police", matchKeyword: "police" },
  { id: "ormari", label: "Ormari", matchKeyword: "ormari" },
];

export default async function NovoPage() {
  const { items: products } = await listProducts({ newOnly: true, limit: 300 });
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
