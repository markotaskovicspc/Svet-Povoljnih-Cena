import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { mockProducts } from "@/data/products";

export const metadata: Metadata = {
  title: "Heroji meseca — preporučena selekcija",
  description:
    "Ručno odabrani komadi sa najboljim odnosom cene i kvaliteta u tekućem mesecu.",
};

export default function HerojiMesecaPage() {
  const products = mockProducts.filter((p) => p.isHero);
  return (
    <ListingShell
      kind="heroji-meseca"
      title="Heroji meseca"
      subtitle="Naša ekipa bira komade kojima verujemo — ovo su pobednici tekućeg meseca."
      trail={[{ label: "Heroji meseca" }]}
      source={products}
    />
  );
}
