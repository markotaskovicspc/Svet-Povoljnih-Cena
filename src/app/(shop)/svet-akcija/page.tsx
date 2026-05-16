import type { Metadata } from "next";
import { connection } from "next/server";
import { SvetAkcijaCatalog } from "@/components/listing/svet-akcija-catalog";
import { getSvetAkcijaProducts } from "@/lib/svet-akcija/db";

export const metadata: Metadata = {
  title: "Svet akcija katalog",
  description:
    "Pregled proizvoda iz izvornog Svet akcija kataloga, sa tačnim šiframa, nazivima, opisima i akcijskim cenama.",
};

export default async function SvetAkcijaPage() {
  await connection();
  const products = await getSvetAkcijaProducts();
  return <SvetAkcijaCatalog products={products} />;
}
