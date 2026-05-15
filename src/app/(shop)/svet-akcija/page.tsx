import type { Metadata } from "next";
import { SvetAkcijaCatalog } from "@/components/listing/svet-akcija-catalog";
import { svetAkcijaProducts } from "@/lib/svet-akcija/catalog";

export const metadata: Metadata = {
  title: "Svet akcija katalog",
  description:
    "Pregled proizvoda iz izvornog Svet akcija kataloga, sa tačnim šiframa, nazivima, opisima i akcijskim cenama.",
};

export default function SvetAkcijaPage() {
  return <SvetAkcijaCatalog products={svetAkcijaProducts} />;
}
