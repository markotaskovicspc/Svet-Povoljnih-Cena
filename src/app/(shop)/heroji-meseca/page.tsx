import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { listProducts } from "@/lib/api/catalog";
import { herojiMesecaIcon } from "@/data/campaign-icons";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";

export const metadata: Metadata = {
  title: "Heroji meseca — preporučena selekcija",
  description:
    "Ručno odabrani komadi sa najboljim odnosom cene i kvaliteta u tekućem mesecu.",
};

export default async function HerojiMesecaPage() {
  const query = { heroOnly: true };
  const { items: products, nextCursor, total } = await listProducts({
    ...query,
    limit: LISTING_PAGE_SIZE,
  });
  return (
    <ListingShell
      kind="heroji-meseca"
      title="Heroji meseca"
      titleIcon={herojiMesecaIcon}
      headerVariant="promo"
      subtitle="Naša ekipa bira komade kojima verujemo — ovo su pobednici tekućeg meseca."
      trail={[{ label: "Heroji meseca" }]}
      source={products}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
    />
  );
}
