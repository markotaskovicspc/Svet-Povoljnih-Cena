import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { protectedPrices } from "@/data/products";

export const metadata: Metadata = {
  title: "Niske cene pod trajnom zaštitom",
  description:
    "Trajno zaštićene akcijske cene uvedene od 01.05.2026. u skladu sa promenama Zakona o trgovini.",
};

export default function NiskeCenePodZastitomPage() {
  return (
    <ListingShell
      kind="niske-cene-pod-zastitom"
      title="Niske cene pod trajnom zaštitom"
      subtitle="Stalna akcija za proizvode čije su cene zaštićene i jasno označene od 01.05.2026."
      trail={[{ label: "Niske cene pod trajnom zaštitom" }]}
      source={protectedPrices()}
    />
  );
}
