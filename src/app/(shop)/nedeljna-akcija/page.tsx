import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { listProducts } from "@/lib/api/catalog";

export const metadata: Metadata = {
  title: "Nedeljna akcija — sedam dana posebnih ponuda",
  description:
    "Brze nedeljne ponude koje se menjaju svake nedelje. Iskoristi dok traju — popusti važe sedam dana.",
};

export default async function NedeljnaAkcijaPage() {
  const { items: products } = await listProducts({ actionSlug: "nedeljna-akcija", limit: 300 });
  const period = products
    .map((p) => p.action!)
    .sort(
      (a, b) =>
        new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime(),
    )[0];

  return (
    <ListingShell
      kind="nedeljna-akcija"
      title="Nedeljna akcija"
      subtitle="Selekcija sedam dana — najatraktivnije ponude nedelje."
      period={
        period ? { endsAt: period.endsAt, label: "Nedeljna ponuda" } : undefined
      }
      trail={[{ label: "Nedeljna akcija" }]}
      source={products}
    />
  );
}
