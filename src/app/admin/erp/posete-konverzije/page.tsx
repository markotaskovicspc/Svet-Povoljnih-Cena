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

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Posete i konverzije · ERP",
  robots: { index: false, follow: false },
};

type FunnelRow = {
  visitors: number;
  purchasers: number;
  purchase_value: number;
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

export default async function AnalyticsConversionPage() {
  await requireAdminAction(allowedRolesForErpModule("posete-konverzije"));
  const now = new Date();
  const periodStart = new Date(now.getTime() - 30 * 86_400_000);
  const activeStart = new Date(now.getTime() - 5 * 60_000);
  const [activeSessions, funnelRows, products, cartConversions, rawModule] =
    await Promise.all([
      db.analyticsEvent.findMany({
        where: { type: "PAGE_VIEW", occurredAt: { gte: activeStart } },
        distinct: ["sessionId", "anonymousId"],
        select: { id: true },
      }),
      db.$queryRaw<FunnelRow[]>(Prisma.sql`
        WITH visitors AS (
          SELECT DISTINCT a."anonymousId"
          FROM "AnalyticsEvent" a
          WHERE a.type = 'PAGE_VIEW'
            AND a."occurredAt" >= ${periodStart}
            AND a."occurredAt" < ${now}
        ), attributed AS (
          SELECT DISTINCT ON (c."orderId")
            c."orderId",
            c."anonymousId",
            COALESCE(c.value, 0)::double precision AS value
          FROM "AnalyticsEvent" c
          WHERE c.type = 'CHECKOUT_COMPLETED'
            AND c."occurredAt" >= ${periodStart}
            AND c."occurredAt" < ${now}
            AND EXISTS (
              SELECT 1
              FROM "AnalyticsEvent" v
              WHERE v.type = 'PAGE_VIEW'
                AND v."anonymousId" = c."anonymousId"
                AND v."occurredAt" <= c."occurredAt"
                AND v."occurredAt" >= c."occurredAt" - interval '30 days'
            )
          ORDER BY c."orderId", c."occurredAt" ASC
        )
        SELECT
          (SELECT COUNT(*) FROM visitors)::int AS visitors,
          (SELECT COUNT(DISTINCT "anonymousId") FROM attributed)::int AS purchasers,
          COALESCE((SELECT SUM(value) FROM attributed), 0)::double precision AS purchase_value
      `),
      db.$queryRaw<ProductPerformanceRow[]>(Prisma.sql`
        WITH visits AS (
          SELECT
            a."productId",
            COUNT(DISTINCT COALESCE(a."sessionId", a."anonymousId"))::int AS visits
          FROM "AnalyticsEvent" a
          WHERE a.type IN ('PRODUCT_VIEW', 'PAGE_VIEW')
            AND a."productId" IS NOT NULL
            AND a."occurredAt" >= ${periodStart}
            AND a."occurredAt" < ${now}
          GROUP BY a."productId"
        ), sales AS (
          SELECT
            l."productId",
            COALESCE(SUM(l.qty), 0)::int AS sold_qty,
            COALESCE(
              SUM(GREATEST(l."totalGross" - l."serviceGross", 0)),
              0
            )::double precision AS fiscal_revenue
          FROM "FiscalDocumentLine" l
          JOIN "FiscalDocument" f ON f.id = l."fiscalDocumentId"
          WHERE f.kind = 'SALE'
            AND f.status = 'ISSUED'
            AND f."issuedAt" >= ${periodStart}
            AND f."issuedAt" < ${now}
            AND l."productId" IS NOT NULL
          GROUP BY l."productId"
        )
        SELECT
          p.id AS product_id,
          p.sku,
          p.name,
          v.visits,
          COALESCE(s.sold_qty, 0)::int AS sold_qty,
          COALESCE(s.fiscal_revenue, 0)::double precision AS fiscal_revenue
        FROM visits v
        JOIN "Product" p ON p.id = v."productId"
        LEFT JOIN sales s ON s."productId" = v."productId"
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
            AND a."occurredAt" >= ${periodStart}
            AND a."occurredAt" < ${now}
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

  const funnel = funnelRows[0] ?? { visitors: 0, purchasers: 0, purchase_value: 0 };
  const conversion = funnel.visitors ? (funnel.purchasers / funnel.visitors) * 100 : 0;
  const valuePerVisit = funnel.visitors ? funnel.purchase_value / funnel.visitors : 0;
  const cartBuyers = new Set(cartConversions.map((row) => row.anonymous_id)).size;
  const convertedCartBuyers = new Set(
    cartConversions.filter((row) => row.purchased_qty > 0).map((row) => row.anonymous_id),
  ).size;

  return (
    <>
      <PageHeader
        title="Posete i konverzije"
        description="Agregati sa 30-dnevnom atribucijom; beleže se samo događaji uz analytics saglasnost."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Tačka 28" },
        ]}
      />
      <div className="space-y-8 px-8 py-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Trenutne posete" value={String(activeSessions.length)} hint="Jedinstvene aktivne sesije u poslednjih 5 minuta" />
          <StatCard label="Poseta → kupovina" value={`${conversion.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })}%`} hint={`${funnel.purchasers} kupaca / ${funnel.visitors} posetilaca`} />
          <StatCard label="Poseta → vrednost" value={formatRsd(valuePerVisit)} hint={`${formatRsd(funnel.purchase_value)} atribuirane vrednosti`} />
          <StatCard label="Korpa → kupovina" value={`${(cartBuyers ? (convertedCartBuyers / cartBuyers) * 100 : 0).toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })}%`} hint={`${convertedCartBuyers} / ${cartBuyers} anonimizovanih kupaca`} />
        </div>

        <Card>
          <CardTitle description="Posete proizvoda i izdata fiskalizovana prodaja u poslednjih 30 dana">Top 50 proizvoda</CardTitle>
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
            empty="Nema poseta proizvoda u poslednjih 30 dana."
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
