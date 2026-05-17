import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { listProducts } from "@/lib/api/catalog";
import { getSectionBanner } from "@/lib/storefront/content";

export const metadata: Metadata = {
  title: "Nedeljna akcija — sedam dana posebnih ponuda",
  description:
    "Brze nedeljne ponude koje se menjaju svake nedelje. Iskoristi dok traju — popusti važe sedam dana.",
};

export default async function NedeljnaAkcijaPage() {
  const [{ items: products }, banner] = await Promise.all([
    listProducts({ actionSlug: "nedeljna-akcija", limit: 300 }),
    getSectionBanner("nedeljna-akcija"),
  ]);

  return (
    <ListingShell
      kind="nedeljna-akcija"
      title="Nedeljna akcija"
      trail={[{ label: "Nedeljna akcija" }]}
      source={products}
      featureBanner={banner ?? undefined}
    />
  );
}
