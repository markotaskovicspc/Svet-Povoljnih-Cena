import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { listProducts } from "@/lib/api/catalog";
import { getSectionBanner } from "@/lib/storefront/content";

export const metadata: Metadata = {
  title: "Specijalne ponude",
  description:
    "Posebne kampanje, kratke akcije i izdvojene ponude van mesečne i nedeljne akcije.",
};

export default async function SpecijalnePonudePage() {
  const [{ items: products }, banner] = await Promise.all([
    listProducts({ actionSlug: "specijalne-ponude", limit: 300 }),
    getSectionBanner("specijalne-ponude"),
  ]);
  return (
    <ListingShell
      kind="akcija"
      title="Specijalne ponude"
      subtitle="Izdvojene kampanje i posebni popusti koji se menjaju po sezoni."
      trail={[{ label: "Specijalne ponude" }]}
      source={products}
      featureBanner={banner ?? undefined}
      featureBannerMobileOnly
    />
  );
}
