import type { Metadata } from "next";
import { connection } from "next/server";
import { SvetAkcijaCatalog } from "@/components/listing/svet-akcija-catalog";
import { getSvetAkcijaProducts } from "@/lib/svet-akcija/db";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${BRAND.name} katalog`,
  description:
    `Pregled proizvoda iz izvornog ${BRAND.name} kataloga, sa tačnim šiframa, nazivima, opisima i akcijskim cenama.`,
};

export default async function SvetAkcijaPage() {
  await connection();
  const products = await getSvetAkcijaProducts();
  return <SvetAkcijaCatalog products={products} />;
}
