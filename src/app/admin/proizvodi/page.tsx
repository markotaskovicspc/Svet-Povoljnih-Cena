import Link from "next/link";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireAdminAction } from "@/lib/admin";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/admin/data-table";
import { Card } from "@/components/admin/card";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Proizvodi",
  robots: { index: false, follow: false },
};

const PAGE = 30;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
}) {
  await requireAdminAction(["CONTENT", "OPS"]);
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const status = sp.status ?? "";

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(q
      ? {
          OR: [
            { sku: { contains: q, mode: "insensitive" as const } },
            { name: { contains: q, mode: "insensitive" as const } },
            { slug: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(status === "inactive" ? { isActive: false } : {}),
    ...(status === "hero" ? { isHero: true } : {}),
    ...(status === "lowstock" ? { stock: { lte: 2 } } : {}),
  };

  const [items, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: PAGE,
      skip: (page - 1) * PAGE,
      select: {
        id: true,
        sku: true,
        name: true,
        slug: true,
        fullPrice: true,
        salePrice: true,
        stock: true,
        incomingStock: true,
        isActive: true,
        isHero: true,
        isNew: true,
      },
    }),
    db.product.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const link = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    Object.entries(extra).forEach(([k, v]) => v && params.set(k, String(v)));
    const s = params.toString();
    return `/admin/proizvodi${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Proizvodi"
        description={`${total.toLocaleString("sr-Latn-RS")} proizvoda — pretraga, filteri, override editor.`}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Proizvodi" }]}
      />
      <div className="space-y-4 px-8 py-6">
        <Card>
          <form className="flex flex-wrap items-end gap-3" method="get">
            <div className="flex-1 min-w-[240px]">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Pretraga (SKU / naziv / slug)
              </label>
              <Input name="q" defaultValue={q} placeholder="npr. KAUC-001" />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Status
              </label>
              <select
                name="status"
                defaultValue={status}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                <option value="">Svi</option>
                <option value="inactive">Neaktivni</option>
                <option value="hero">Hero meseca</option>
                <option value="lowstock">Niske zalihe</option>
              </select>
            </div>
            <button
              type="submit"
              className="h-8 rounded-lg bg-walnut px-4 text-sm font-medium text-white hover:bg-walnut/90"
            >
              Filtriraj
            </button>
          </form>
        </Card>

        <DataTable
          columns={[
            { key: "sku", label: "SKU" },
            { key: "name", label: "Naziv" },
            { key: "price", label: "Cena", align: "right" },
            { key: "stock", label: "Stanje", align: "right" },
            { key: "flags", label: "Oznake" },
            { key: "actions", label: "" },
          ]}
          rows={items.map((p) => ({
            id: p.id,
            cells: {
              sku: <span className="font-mono text-xs">{p.sku}</span>,
              name: (
                <div>
                  <p className="font-medium text-ink-900">{p.name}</p>
                  <p className="text-xs text-ink-500">/p/{p.slug}</p>
                </div>
              ),
              price: (
                <div className="text-right">
                  {p.salePrice ? (
                    <>
                      <p className="text-action">{formatRsd(num(p.salePrice))}</p>
                      <p className="text-xs text-ink-500 line-through">
                        {formatRsd(num(p.fullPrice))}
                      </p>
                    </>
                  ) : (
                    formatRsd(num(p.fullPrice))
                  )}
                </div>
              ),
              stock: (
                <div className="text-right">
                  <p className={p.stock === 0 ? "text-danger" : ""}>{p.stock}</p>
                  {p.incomingStock > 0 ? (
                    <p className="text-xs text-ink-500">+{p.incomingStock}</p>
                  ) : null}
                </div>
              ),
              flags: (
                <div className="flex flex-wrap gap-1 text-[11px]">
                  {!p.isActive ? (
                    <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">
                      Neaktivan
                    </span>
                  ) : null}
                  {p.isHero ? (
                    <span className="rounded bg-walnut/15 px-1.5 py-0.5 text-walnut">
                      Hero
                    </span>
                  ) : null}
                  {p.isNew ? (
                    <span className="rounded bg-info/15 px-1.5 py-0.5 text-info">Novo</span>
                  ) : null}
                </div>
              ),
              actions: (
                <Link
                  href={`/admin/proizvodi/${p.id}`}
                  className="text-xs text-walnut hover:underline"
                >
                  Otvori →
                </Link>
              ),
            },
          }))}
          empty="Nema rezultata."
        />

        {pages > 1 ? (
          <div className="flex items-center justify-between text-sm text-ink-500">
            <span>
              Strana {page} od {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link
                  href={link({ page: page - 1 })}
                  className="rounded-md border border-border px-3 py-1 hover:bg-muted-bg"
                >
                  ← Prethodna
                </Link>
              ) : null}
              {page < pages ? (
                <Link
                  href={link({ page: page + 1 })}
                  className="rounded-md border border-border px-3 py-1 hover:bg-muted-bg"
                >
                  Sledeća →
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
