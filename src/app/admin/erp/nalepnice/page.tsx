import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { ProductLabelPrint } from "@/components/admin/product-label-print";
import { productLabelArticle, productLabelSelect } from "@/lib/admin/product-labels.server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nalepnice za kutije", robots: { index: false, follow: false } };

export default async function ProductLabelsPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  await requireAdminAction(["CONTENT", "OPS"]);
  const { product: id } = await searchParams;
  const product = id ? await db.product.findUnique({ where: { id }, select: productLabelSelect }) : null;
  return <>
    <PageHeader title="Nalepnice za kutije" description="Slika, naziv, barkod, uvoznik, zemlja porekla i šifra artikla u jednom formatu za štampu." crumbs={[{ href: "/admin", label: "Admin" }, { href: "/admin/erp/artikli", label: "Artikli" }, { label: "Nalepnice za kutije" }]}/>
    <div className="px-4 py-5 md:px-8"><ProductLabelPrint key={id ?? "empty"} initialArticle={product ? productLabelArticle(product) : undefined}/></div>
  </>;
}
