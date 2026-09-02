import { Prisma } from "@prisma/client";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import { getErpModule } from "@/lib/admin/erp";
import { formatRsd } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { ErpGrid } from "@/components/admin/erp-grid";
import { Input } from "@/components/ui/input";
import { REPORT_PERIOD_PRESETS, resolveReportPeriod } from "@/lib/admin/report-period";
import {
  getAnalyticsFunnelSummary,
  getPageConversionReport,
  normalizeAnalyticsGranularity,
} from "@/lib/admin/analytics-report.server";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Posete i konverzije · ERP",
  robots: { index: false, follow: false },
};

type ProductPerformanceRow = {
  product_id: string;
  sku: string;
  name: string;
  visits: number;
  sold_qty: number;
  fiscal_revenue: number;
};

type CartConversionRow = {
  anonymous_id: string;
  product_id: string;
  sku: string;
  name: string;
  cart_events: number;
  cart_qty: number;
  purchased_qty: number;
  purchase_value: number;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AnalyticsConversionPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string | string[];
    from?: string | string[];
    to?: string | string[];
    group?: string | string[];
  }>;
}) {
  await requireAdminAction(allowedRolesForErpModule("posete-konverzije"));
  const params = await searchParams;
  const now = new Date();
  const period = resolveReportPeriod(
    {
      range: first(params.range),
      from: first(params.from),
      to: first(params.to),
    },
    now,
  );
  const granularity = normalizeAnalyticsGranularity(params.group);
  const activeStart = new Date(now.getTime() - 5 * 60_000);
  const [activeSessions, funnel, pageConversions, products, cartConversions, rawModule] =
    await Promise.all([
      db.analyticsEvent.findMany({
        where: { type: "PAGE_VIEW", occurredAt: { gte: activeStart } },
        distinct: ["sessionId", "anonymousId"],
        select: { id: true },
      }),
      getAnalyticsFunnelSummary(period),
      getPageConversionReport(period, granularity),
      db.$queryRaw<ProductPerformanceRow[]>(Prisma.sql`
        WITH visits AS (
          SELECT
            a."productId",
            COUNT(DISTINCT COALESCE(a."sessionId", a."anonymousId"))::int AS visits
          FROM "AnalyticsEvent" a
          WHERE a.type IN ('PRODUCT_VIEW', 'PAGE_VIEW')
            AND a."productId" IS NOT NULL
            AND a."occurredAt" >= ${period.start}
            AND a."occurredAt" < ${period.endExclusive}
          GROUP BY a."productId"
        ), fiscalized AS (
          SELECT
            l."productId",
            COALESCE(
              SUM(CASE WHEN f.kind = 'REFUND' THEN -l.qty ELSE l.qty END),
              0
            )::int AS sold_qty,
            COALESCE(
              SUM(
                (CASE WHEN f.kind = 'REFUND' THEN -1 ELSE 1 END) *
                GREATEST(l."totalGross" - l."serviceGross", 0)
              ),
              0
            )::double precision AS fiscal_revenue
          FROM "FiscalDocumentLine" l
          JOIN "FiscalDocument" f ON f.id = l."fiscalDocumentId"
          WHERE f.kind IN ('SALE', 'REFUND')
            AND f.status = 'ISSUED'
            AND f."issuedAt" >= ${period.start}
            AND f."issuedAt" < ${period.endExclusive}
            AND l."productId" IS NOT NULL
          GROUP BY l."productId"
        )
        SELECT
          p.id AS product_id,
          p.sku,
          p.name,
          v.visits,
          COALESCE(f.sold_qty, 0)::int AS sold_qty,
          COALESCE(f.fiscal_revenue, 0)::double precision AS fiscal_revenue
        FROM visits v
        JOIN "Product" p ON p.id = v."productId"
        LEFT JOIN fiscalized f ON f."productId" = v."productId"
        ORDER BY v.visits DESC, fiscal_revenue DESC, p.sku ASC
        LIMIT 50
      `),
      db.$queryRaw<CartConversionRow[]>(Prisma.sql`
        WITH carts AS (
          SELECT
            a."anonymousId",
            a."productId",
            COUNT(*)::int AS cart_events,
            COALESCE(SUM(a.quantity), 0)::int AS cart_qty,
            MIN(a."occurredAt") AS first_cart_at
          FROM "AnalyticsEvent" a
          WHERE a.type = 'ADD_TO_CART'
            AND a."productId" IS NOT NULL
            AND a."occurredAt" >= ${period.start}
            AND a."occurredAt" < ${period.endExclusive}
          GROUP BY a."anonymousId", a."productId"
        ), purchases AS (
          SELECT
            carts."anonymousId",
            oi."productId",
            COALESCE(SUM(oi.qty), 0)::int AS purchased_qty,
            COALESCE(SUM(oi.qty * oi."unitPriceSale"), 0)::double precision AS purchase_value
          FROM carts
          JOIN "AnalyticsEvent" c
            ON c."anonymousId" = carts."anonymousId"
            AND c.type = 'CHECKOUT_COMPLETED'
            AND c."occurredAt" >= carts.first_cart_at
            AND c."occurredAt" <= carts.first_cart_at + interval '30 days'
          JOIN "OrderItem" oi ON oi."orderId" = c."orderId"
            AND oi."productId" = carts."productId"
          WHERE c."orderId" IS NOT NULL
          GROUP BY carts."anonymousId", oi."productId"
        )
        SELECT
          carts."anonymousId" AS anonymous_id,
          p.id AS product_id,
          p.sku,
          p.name,
          carts.cart_events,
          carts.cart_qty,
          COALESCE(purchases.purchased_qty, 0)::int AS purchased_qty,
          COALESCE(purchases.purchase_value, 0)::double precision AS purchase_value
        FROM carts
        JOIN "Product" p ON p.id = carts."productId"
        LEFT JOIN purchases
          ON purchases."anonymousId" = carts."anonymousId"
          AND purchases."productId" = carts."productId"
        ORDER BY carts.cart_events DESC, p.sku ASC
        LIMIT 100
      `),
      getErpModule("posete-konverzije", { take: 100 }),
    ]);

  const conversion = funnel.visitors ? (funnel.purchasers / funnel.visitors) * 100 : 0;
  const valuePerVisit = funnel.visitors ? funnel.purchaseValue / funnel.visitors : 0;
  const cartConversion = funnel.cartBuyers
    ? (funnel.convertedCartBuyers / funnel.cartBuyers) * 100
    : 0;
  const exportHref = `/api/admin/analytics/conversions/export?range=${encodeURIComponent(period.preset)}&from=${period.fromInput}&to=${period.toInput}&group=${granularity}`;

  return (
    <>
      <PageHeader
        title="Posete i konverzije"
        description="Posete po stranici i konverzije; kupovina se pripisuje poslednjoj posećenoj stranici pre checkout-a."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Tačka 28" },
        ]}
      />
      <div className="space-y-8 px-8 py-6">
        <form method="get" className="grid gap-3 rounded-xl border border-border/60 bg-surface p-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-medium text-ink-600">
            Period
            <select name="range" defaultValue={period.preset} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm">
              {REPORT_PERIOD_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>{preset.label}</option>
              ))}
              <option value="custom">Tačan raspon</option>
            </select>
          </label>
          <label className="text-xs font-medium text-ink-600">
            Od
            <Input name="from" type="date" defaultValue={period.fromInput} className="mt-1 h-9" />
          </label>
          <label className="text-xs font-medium text-ink-600">
            Do
            <Input name="to" type="date" defaultValue={period.toInput} className="mt-1 h-9" />
          </label>
          <label className="text-xs font-medium text-ink-600">
            Grupisanje
            <select name="group" defaultValue={granularity} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm">
              <option value="day">Dnevno</option>
              <option value="week">Nedeljno</option>
              <option value="month">Mesečno</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button className="h-9 rounded-lg bg-walnut px-4 text-sm font-medium text-white">Primeni</button>
            <Link href={exportHref} className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-ink-700">Excel</Link>
          </div>
        </form>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Trenutne posete" value={String(activeSessions.length)} hint="Jedinstvene aktivne sesije u poslednjih 5 minuta" />
          <StatCard label="Poseta → kupovina" value={`${conversion.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })}%`} hint={`${funnel.purchasers} kupaca / ${funnel.visitors} posetilaca · ${period.label}`} />
          <StatCard label="Poseta → vrednost" value={formatRsd(valuePerVisit)} hint={`${formatRsd(funnel.purchaseValue)} atribuirane vrednosti · ${period.label}`} />
          <StatCard label="Korpa → kupovina" value={`${cartConversion.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })}%`} hint={`${funnel.convertedCartBuyers} / ${funnel.cartBuyers} anonimizovanih kupaca · ${period.label}`} />
        </div>

        <Card>
          <CardTitle description={`${period.label}; kupovina se pripisuje poslednjem PAGE_VIEW događaju pre checkout-a.`}>
            Posete i konverzije po stranici
          </CardTitle>
          <DataTable
            columns={[
              { key: "period", label: granularity === "day" ? "Dan" : granularity === "week" ? "Nedelja od" : "Mesec" },
              { key: "path", label: "Stranica" },
              { key: "pageViews", label: "Pregledi", align: "right" },
              { key: "visits", label: "Jedinstvene posete", align: "right" },
              { key: "purchases", label: "Kupovine", align: "right" },
              { key: "conversion", label: "Konverzija", align: "right" },
              { key: "value", label: "Vrednost", align: "right" },
            ]}
            rows={pageConversions.map((row) => ({
              id: `${row.bucket}:${row.path}`,
              cells: {
                period: row.bucket,
                path: <span className="font-mono text-xs">{row.path}</span>,
                pageViews: row.pageViews,
                visits: row.visits,
                purchases: row.purchases,
                conversion: `${row.conversionPct.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })}%`,
                value: formatRsd(row.purchaseValue),
              },
            }))}
            empty="Nema consented poseta u izabranom periodu."
          />
        </Card>

        <Card>
          <CardTitle description={`Posete proizvoda i izdata fiskalizovana prodaja · ${period.label}`}>Top 50 proizvoda</CardTitle>
          <DataTable
            columns={[
              { key: "sku", label: "SKU" },
              { key: "name", label: "Naziv" },
              { key: "visits", label: "Posete", align: "right" },
              { key: "qty", label: "Fiskalizovano komada", align: "right" },
              { key: "revenue", label: "Fiskalizovani promet", align: "right" },
            ]}
            rows={products.map((row) => ({
              id: row.product_id,
              cells: {
                sku: <span className="font-mono text-xs">{row.sku}</span>,
                name: row.name,
                visits: row.visits,
                qty: row.sold_qty,
                revenue: formatRsd(row.fiscal_revenue),
              },
            }))}
            empty="Nema poseta proizvoda u izabranom periodu."
          />
        </Card>

        <Card>
          <CardTitle description="Anonimni identitet i artikal; kupovina se povezuje samo u consented 30-dnevnom prozoru">Korpa po kupcu i artiklu</CardTitle>
          <DataTable
            columns={[
              { key: "buyer", label: "Anonimni kupac" },
              { key: "sku", label: "SKU" },
              { key: "name", label: "Naziv" },
              { key: "cart", label: "Dodavanja / komada", align: "right" },
              { key: "purchase", label: "Kupljeno", align: "right" },
              { key: "value", label: "Vrednost", align: "right" },
            ]}
            rows={cartConversions.map((row) => ({
              id: `${row.anonymous_id}-${row.product_id}`,
              cells: {
                buyer: <span className="font-mono text-xs">{`${row.anonymous_id.slice(0, 8)}…`}</span>,
                sku: <span className="font-mono text-xs">{row.sku}</span>,
                name: row.name,
                cart: `${row.cart_events} / ${row.cart_qty}`,
                purchase: row.purchased_qty,
                value: formatRsd(row.purchase_value),
              },
            }))}
            empty="Nema događaja dodavanja u korpu u poslednjih 30 dana."
          />
        </Card>

        {rawModule ? (
          <section className="space-y-3">
            <div>
              <h2 className="font-display text-2xl text-ink-900">Raw drilldown</h2>
              <p className="text-sm text-ink-500">Najnoviji consented first-party događaji, sa standardnim ERP filterima i XLSX izvozom.</p>
            </div>
            <ErpGrid module={rawModule} />
          </section>
        ) : null}
      </div>
    </>
  );
}
