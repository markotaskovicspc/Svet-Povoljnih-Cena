import type { Metadata } from "next";
import { connection } from "next/server";
import { SvetAkcijaCatalog } from "@/components/listing/svet-akcija-catalog";
import { getSvetAkcijaProducts } from "@/lib/svet-akcija/db";
import { BRAND } from "@/lib/brand";

const SVET_AKCIJA_PAGE_SIZE = 60;

export const metadata: Metadata = {
  title: `${BRAND.name} katalog`,
  description:
    `Pregled proizvoda iz izvornog ${BRAND.name} kataloga, sa tačnim šiframa, nazivima, opisima i akcijskim cenama.`,
};

interface SvetAkcijaPageProps {
  searchParams: Promise<{ page?: string | string[] }>;
}

export default async function SvetAkcijaPage({ searchParams }: SvetAkcijaPageProps) {
  await connection();
  const params = await searchParams;
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const allProducts = await getSvetAkcijaProducts();
  const pageCount = Math.max(1, Math.ceil(allProducts.length / SVET_AKCIJA_PAGE_SIZE));
  const page = Math.min(
    pageCount,
    Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1),
  );
  const start = (page - 1) * SVET_AKCIJA_PAGE_SIZE;
  const products = allProducts.slice(start, start + SVET_AKCIJA_PAGE_SIZE);

  return (
    <SvetAkcijaCatalog
      products={products}
      totalProducts={allProducts.length}
      page={page}
      pageSize={SVET_AKCIJA_PAGE_SIZE}
    />
  );
}
