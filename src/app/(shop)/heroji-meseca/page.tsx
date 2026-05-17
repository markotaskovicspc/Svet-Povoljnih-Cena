import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import type { Banner } from "@/types";
import { listProducts } from "@/lib/api/catalog";

export const metadata: Metadata = {
  title: "Heroji meseca — preporučena selekcija",
  description:
    "Ručno odabrani komadi sa najboljim odnosom cene i kvaliteta u tekućem mesecu.",
};

export default async function HerojiMesecaPage() {
  const { items: products } = await listProducts({ heroOnly: true, limit: 300 });
  const banner: Banner = {
    id: "heroji-meseca-listing",
    title: "Heroji meseca",
    subtitle:
      "Naša ekipa bira komade kojima verujemo — ovo su pobednici tekućeg meseca.",
    ctaLabel: "Pogledaj ponudu",
    ctaHref: "/heroji-meseca",
    imageDesktop: {
      url: "/brand/heroji-meseca.png",
      alt: "Heroji meseca",
      width: 420,
      height: 360,
    },
    order: 0,
  };
  return (
    <ListingShell
      kind="heroji-meseca"
      title="Heroji meseca"
      trail={[{ label: "Heroji meseca" }]}
      source={products}
      featureBanner={banner}
    />
  );
}
