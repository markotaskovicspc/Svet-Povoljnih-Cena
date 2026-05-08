import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireAdminAction } from "@/lib/admin";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Izveštaji",
  robots: { index: false, follow: false },
};

const RANGES = {
  "7d": { label: "Poslednjih 7 dana", days: 7 },
  "30d": { label: "Poslednjih 30 dana", days: 30 },
  "90d": { label: "Poslednjih 90 dana", days: 90 },
  ytd: { label: "Od početka godine", days: 0 },
} as const;

type RangeKey = keyof typeof RANGES;

function rangeStart(key: RangeKey): Date {
  if (key === "ytd") {
    return new Date(new Date().getFullYear(), 0, 1);
  }
  const d = new Date();
  d.setDate(d.getDate() - RANGES[key].days);
  return d;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireAdminAction(["CONTENT", "OPS", "ADS"]);
  const sp = await searchParams;
  const rangeKey = (sp.range && sp.range in RANGES ? sp.range : "30d") as RangeKey;
  const since = rangeStart(rangeKey);

  const where = { createdAt: { gte: since }, status: { notIn: ["OTKAZANO" as const] } };

  const [agg, ordersCount, topItems, topCategoriesRaw] = await Promise.all([
    db.order.aggregate({
      where,
      _sum: { total: true, subtotal: true, shipping: true, voucherDiscount: true, savings: true },
    }),
    db.order.count({ where }),
    db.orderItem.groupBy({
      by: ["sku", "name"],
      where: { order: where },
      _sum: { qty: true, unitPriceSale: true },
      orderBy: { _sum: { qty: "desc" } },
      take: 20,
    }),
    db.$queryRaw<{ category: string; revenue: number; qty: number }[]>(Prisma.sql`
      SELECT COALESCE(c.name, '—') AS category,
             SUM(oi.qty)::int AS qty,
             SUM(oi.qty * oi."unitPriceSale")::float AS revenue
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      LEFT JOIN "Product" p ON p.id = oi."productId"
      LEFT JOIN "ProductCategory" pc ON pc."productId" = p.id
      LEFT JOIN "Category" c ON c.id = pc."categoryId"
      WHERE o."createdAt" >= ${since} AND o.status <> 'OTKAZANO'
      GROUP BY COALESCE(c.name, '—')
      ORDER BY revenue DESC NULLS LAST
      LIMIT 10
    `),
  ]);

  const aov = ordersCount > 0 ? num(agg._sum.total ?? 0) / ordersCount : 0;

  return (
    <>
      <PageHeader
        title="Izveštaji"
        description={RANGES[rangeKey].label}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Izveštaji" }]}
      />
      <div className="space-y-6 px-8 py-6">
        <nav className="flex flex-wrap gap-2 text-xs">
          {(Object.keys(RANGES) as RangeKey[]).map((k) => (
            <a
              key={k}
              href={`?range=${k}`}
              className={`rounded-full px-3 py-1 ${
                rangeKey === k
                  ? "bg-walnut text-white"
                  : "bg-muted-bg text-ink-700 hover:bg-muted-bg/70"
              }`}
            >
              {RANGES[k].label}
            </a>
          ))}
        </nav>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <StatCard label="Promet" value={formatRsd(num(agg._sum.total ?? 0))} />
          <StatCard label="Narudžbine" value={ordersCount.toLocaleString("sr-Latn-RS")} />
          <StatCard label="Prosečna korpa" value={formatRsd(aov)} />
          <StatCard label="Vaučer popusti" value={formatRsd(num(agg._sum.voucherDiscount ?? 0))} />
        </div>

        <Card>
          <CardTitle>Top 20 SKU-ova po prodatoj količini</CardTitle>
          <DataTable
            columns={[
              { key: "sku", label: "SKU" },
              { key: "name", label: "Naziv" },
              { key: "qty", label: "Komada", align: "right" },
            ]}
            rows={topItems.map((t, i) => ({
              id: `${t.sku}-${i}`,
              cells: {
                sku: <span className="font-mono text-xs">{t.sku}</span>,
                name: t.name,
                qty: t._sum.qty ?? 0,
              },
            }))}
            empty="Bez prodaje u periodu."
          />
        </Card>

        <Card>
          <CardTitle>Top kategorije po prometu</CardTitle>
          <DataTable
            columns={[
              { key: "cat", label: "Kategorija" },
              { key: "qty", label: "Komada", align: "right" },
              { key: "rev", label: "Promet", align: "right" },
            ]}
            rows={topCategoriesRaw.map((r, i) => ({
              id: `${r.category}-${i}`,
              cells: {
                cat: r.category,
                qty: r.qty,
                rev: formatRsd(r.revenue ?? 0),
              },
            }))}
            empty="Bez podataka."
          />
        </Card>
      </div>
    </>
  );
}
