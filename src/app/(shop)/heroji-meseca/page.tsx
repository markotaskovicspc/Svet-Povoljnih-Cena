import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { listProducts } from "@/lib/api/catalog";
import { herojiMesecaIcon } from "@/data/campaign-icons";

export const metadata: Metadata = {
  title: "Heroji meseca — preporučena selekcija",
  description:
    "Ručno odabrani komadi sa najboljim odnosom cene i kvaliteta u tekućem mesecu.",
};

export default async function HerojiMesecaPage() {
  const { items: products } = await listProducts({ heroOnly: true, limit: 300 });
  return (
    <ListingShell
      kind="heroji-meseca"
      title="Heroji meseca"
      titleIcon={herojiMesecaIcon}
      headerVariant="promo"
      subtitle="Naša ekipa bira komade kojima verujemo — ovo su pobednici tekućeg meseca."
      trail={[{ label: "Heroji meseca" }]}
      source={products}
    />
  );
}
