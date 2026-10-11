import Link from "next/link";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { ProductSetForm } from "./form";
import { formatRsd as formatMoney } from "@/lib/format";
const formatRsd = (value: number) => formatMoney(value, true);
export const dynamic = "force-dynamic";
export const metadata = { title: "Prodajni setovi · ERP", robots: { index: false, follow: false } };
export default async function ProductSetsAdmin({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireAdminAction(["CONTENT", "OPS"]);
  const { id } = await searchParams;
  const sets = await db.productSet.findMany({ orderBy: { updatedAt: "desc" }, include: { components: { orderBy: { position: "asc" }, include: { product: { select: { sku: true, name: true } } } } } });
  const selected = sets.find(s => s.id === id);
  const price = (set: typeof sets[number]) => Math.round(set.components.reduce((n, c) => n + Number(c.unitPrice) * c.quantity * 100, 0)) / 100;
  return <><PageHeader title="Prodajni setovi" description="Sastav, zajednička cena i dostupnost iz zaliha komponenti." crumbs={[{ href: "/admin", label: "Admin" }, { href: "/admin/erp", label: "ERP" }, { label: "Setovi" }]} actions={<Link className="rounded-lg border px-3 py-2 text-sm" href="/admin/erp/setovi">Novi set</Link>} />
    <div className="grid gap-6 px-4 py-6 md:px-8 xl:grid-cols-[minmax(260px,1fr)_2fr]">
      <section aria-label="Postojeći setovi" className="space-y-3">{sets.length === 0 && <p className="rounded-xl border p-5 text-sm text-muted-foreground">Još nema setova. Kreirajte prvi set i dodajte njegove artikle.</p>}{sets.map(s => <Link href={`/admin/erp/setovi?id=${s.id}`} key={s.id} className={`block rounded-xl border p-4 hover:bg-muted ${selected?.id === s.id ? "border-foreground" : "border-border"}`}><h2 className="font-semibold">{s.name}</h2><p className="mt-1 text-sm text-muted-foreground">{s.active ? "Objavljen" : "Nacrt"} · {s.components.length} artikala · {formatRsd(price(s))}</p></Link>)}<Link className="inline-block text-sm underline" href="/setovi" target="_blank">Otvori ponudu setova ↗</Link></section>
      <ProductSetForm key={selected?.id ?? "new"} value={selected ? { id: selected.id, name: selected.name, slug: selected.slug, description: selected.description, active: selected.active, version: selected.updatedAt.toISOString(), price: price(selected), components: selected.components.map(c => ({ sku: c.product.sku, name: c.product.name, quantity: c.quantity, unitPrice: Number(c.unitPrice) })) } : undefined} />
    </div></>;
}
