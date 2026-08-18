import Link from "next/link";
import {
  buildReclamationAnalytics,
  type DeliveredProductRow,
  type DeliveredSupplierRow,
  type ReclamationAnalyticsRow,
  type ReclamationBreakdown,
} from "@/lib/admin/reclamation-analytics";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { PageHeader } from "@/components/admin/page-header";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Reklamacije – izveštaji",
  robots: { index: false, follow: false },
};

const TYPE_LABELS: Record<string, string> = {
  FIZICKO_OSTECENJE: "Fizičko oštećenje",
  KVAR: "Kvar",
  NIJE_UNETO: "Nije uneto",
};

const RESOLUTION_LABELS: Record<string, string> = {
  POVRAT_NOVCA: "Povrat novca",
  ZAMENA_ARTIKLA: "Zamena artikla",
  ZAMENA_DELA: "Zamena dela",
  POPUST: "Popust",
  NIJE_UNETO: "Nije određeno",
};

export default async function ReclamationReportsPage() {
  await requireAdminAction(["OPS"]);
  const [rows, deliveredBySupplier, deliveredByProduct] = await Promise.all([
    db.$queryRaw<ReclamationAnalyticsRow[]>`
      SELECT
        r.id,
        r.sku,
        r.status::text AS status,
        r.type::text AS type,
        r.resolution::text AS resolution,
        r."createdAt" AS "createdAt",
        r."resolvedAt" AS "resolvedAt",
        COALESCE(NULLIF(BTRIM(oi.name), ''), NULLIF(BTRIM(p.name), ''), r.sku) AS "productName",
        COALESCE(NULLIF(BTRIM(oi."supplierName"), ''), NULLIF(BTRIM(s.name), ''), 'Bez dobavljača') AS supplier
      FROM "Reclamation" r
      LEFT JOIN "OrderItem" oi ON oi.id = r."orderItemId"
      LEFT JOIN "Product" p ON p.id = COALESCE(r."productId", oi."productId")
      LEFT JOIN "Supplier" s ON s.id = p."supplierId"
    `,
    db.$queryRaw<DeliveredSupplierRow[]>`
      SELECT
        COALESCE(NULLIF(BTRIM(oi."supplierName"), ''), NULLIF(BTRIM(s.name), ''), 'Bez dobavljača') AS supplier,
        COALESCE(SUM(oi.qty), 0)::int AS "deliveredItems"
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      LEFT JOIN "Product" p ON p.id = oi."productId"
      LEFT JOIN "Supplier" s ON s.id = p."supplierId"
      WHERE o.status = 'ISPORUCENO'
      GROUP BY 1
    `,
    db.$queryRaw<DeliveredProductRow[]>`
      SELECT oi.sku, COALESCE(SUM(oi.qty), 0)::int AS "deliveredItems"
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE o.status = 'ISPORUCENO'
      GROUP BY oi.sku
    `,
  ]);
  const analytics = buildReclamationAnalytics(
    rows,
    deliveredBySupplier,
    deliveredByProduct,
  );

  return (
    <>
      <PageHeader
        title="Reklamacije – izveštaji"
        description="Ukupni pokazatelji, dobavljači i artikli odvojeni od operativnog dnevnika."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Reklamacije – izveštaji" },
        ]}
        actions={<Link href="/admin/erp/reklamacije-dnevnik" className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">Dnevnik reklamacija</Link>}
      />
      <div className="space-y-10 px-8 py-6">
        <section aria-labelledby="reclamation-overview" className="space-y-4">
          <SectionHeading id="reclamation-overview" eyebrow="Pregled poslovanja" title="Ukupni pokazatelji" description="Podaci za sve vreme. Procenat je broj reklamacija u odnosu na broj artikala iz isporučenih porudžbina." />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Ukupno reklamacija" value={formatInteger(analytics.totals.total)} hint={`${formatInteger(analytics.totals.deliveredItems)} isporučenih artikala`} />
            <StatCard label="% reklamacija" value={formatPercent(analytics.totals.reclamationRate)} hint="Reklamacije / isporučeni artikli" />
            <StatCard label="Rešene" value={formatInteger(analytics.totals.resolved)} tone="success" hint="Uključuje rešene i odbijene" />
            <StatCard label="Nerešene" value={formatInteger(analytics.totals.unresolved)} tone={analytics.totals.unresolved > 0 ? "warning" : "default"} hint="Primljene i u obradi" />
            <StatCard label="Nerešene > 5 dana" value={formatInteger(analytics.totals.unresolvedOver5Days)} tone={analytics.totals.unresolvedOver5Days > 0 ? "warning" : "default"} hint="Kumulativno, još otvorene" />
            <StatCard label="Nerešene > 10 dana" value={formatInteger(analytics.totals.unresolvedOver10Days)} tone={analytics.totals.unresolvedOver10Days > 0 ? "warning" : "default"} hint="Kumulativno, još otvorene" />
            <StatCard label="Nerešene > 20 dana" value={formatInteger(analytics.totals.unresolvedOver20Days)} tone={analytics.totals.unresolvedOver20Days > 0 ? "danger" : "default"} hint="Kumulativno, još otvorene" />
            <StatCard label="Nerešene > 30 dana" value={formatInteger(analytics.totals.unresolvedOver30Days)} tone={analytics.totals.unresolvedOver30Days > 0 ? "danger" : "default"} hint="Kumulativno, još otvorene" />
            <StatCard label="Prosečno rešavanje" value={formatDays(analytics.totals.averageResolutionDays)} hint="Od prijema do zatvaranja reklamacije" />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardTitle description="Uključene su i reklamacije kojima tip još nije unet.">Reklamacije po tipu</CardTitle>
              <BreakdownTable rows={analytics.totals.byType} total={analytics.totals.total} labels={TYPE_LABELS} empty="Nema reklamacija." />
            </Card>
            <Card>
              <CardTitle description="Kod otvorenih reklamacija način rešavanja može biti neodređen.">Reklamacije po načinu rešavanja</CardTitle>
              <BreakdownTable rows={analytics.totals.byResolution} total={analytics.totals.total} labels={RESOLUTION_LABELS} empty="Nema reklamacija." />
            </Card>
          </div>
        </section>

        <section aria-labelledby="supplier-overview" className="space-y-4">
          <SectionHeading id="supplier-overview" eyebrow="Dobavljači" title="Isti pokazatelji po dobavljaču" description="Dobavljač se prvenstveno čita iz stavke porudžbine, kako istorijski podaci ne bi zavisili od kasnijih izmena kataloga." />
          <DataTable
            columns={[
              { key: "supplier", label: "Dobavljač" },
              { key: "total", label: "Reklamacije", align: "right" },
              { key: "rate", label: "%", align: "right" },
              { key: "types", label: "Po tipu" },
              { key: "resolutions", label: "Način rešavanja" },
              { key: "resolved", label: "Rešene", align: "right" },
              { key: "unresolved", label: "Nerešene", align: "right" },
              { key: "over5", label: "> 5 d", align: "right" },
              { key: "over10", label: "> 10 d", align: "right" },
              { key: "over20", label: "> 20 d", align: "right" },
              { key: "over30", label: "> 30 d", align: "right" },
              { key: "average", label: "Prosek", align: "right" },
            ]}
            rows={analytics.suppliers.map((supplier) => ({
              id: supplier.supplier,
              cells: {
                supplier: <div className="min-w-40"><p className="font-medium text-ink-900">{supplier.supplier}</p><p className="text-xs text-ink-500">{formatInteger(supplier.deliveredItems)} isporučenih artikala</p></div>,
                total: formatInteger(supplier.total),
                rate: formatPercent(supplier.reclamationRate),
                types: <BreakdownCell rows={supplier.byType} labels={TYPE_LABELS} />,
                resolutions: <BreakdownCell rows={supplier.byResolution} labels={RESOLUTION_LABELS} />,
                resolved: formatInteger(supplier.resolved),
                unresolved: formatInteger(supplier.unresolved),
                over5: formatInteger(supplier.unresolvedOver5Days),
                over10: formatInteger(supplier.unresolvedOver10Days),
                over20: formatInteger(supplier.unresolvedOver20Days),
                over30: formatInteger(supplier.unresolvedOver30Days),
                average: formatDays(supplier.averageResolutionDays),
              },
            }))}
            empty="Nema reklamacija po dobavljaču."
          />
        </section>

        <section aria-labelledby="top-products" className="space-y-4">
          <SectionHeading id="top-products" eyebrow="Artikli" title="Top 20 reklamiranih artikala" description="Odvojeni prikazi po ukupnom broju reklamacija i po procentu u odnosu na isporučenu količinu." />
          <div className="grid gap-6">
            <Card>
              <CardTitle description="Rangirano po ukupnom broju reklamacija.">
                Top 20 artikala sa najviše reklamacija
              </CardTitle>
              <div data-reclamation-ranking="count">
                <ProductRankingTable products={analytics.topProducts} />
              </div>
            </Card>
            <Card>
              <CardTitle description="Rangirano po procentu reklamacija u odnosu na isporučenu količinu.">
                Top 20 artikala po procentu reklamacija
              </CardTitle>
              <div data-reclamation-ranking="rate">
                <ProductRankingTable products={analytics.topProductsByRate} />
              </div>
            </Card>
          </div>
        </section>
      </div>
    </>
  );
}

function SectionHeading({ id, eyebrow, title, description }: { id: string; eyebrow: string; title: string; description: string }) {
  return <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-walnut">{eyebrow}</p><h2 id={id} className="mt-1 font-display text-2xl text-ink-900">{title}</h2><p className="mt-1 max-w-3xl text-sm text-ink-500">{description}</p></div>;
}

function BreakdownTable({ rows, total, labels, empty }: { rows: ReclamationBreakdown[]; total: number; labels: Record<string, string>; empty: string }) {
  return <DataTable columns={[{ key: "label", label: "Kategorija" }, { key: "count", label: "Broj", align: "right" }, { key: "share", label: "Udeo", align: "right" }]} rows={rows.map((row) => ({ id: row.key, cells: { label: labels[row.key] ?? row.key, count: formatInteger(row.count), share: formatPercent(total > 0 ? (row.count / total) * 100 : 0) } }))} empty={empty} />;
}

function BreakdownCell({ rows, labels }: { rows: ReclamationBreakdown[]; labels: Record<string, string> }) {
  return <div className="min-w-36 space-y-0.5 text-xs">{rows.map((row) => <p key={row.key} className="whitespace-nowrap">{labels[row.key] ?? row.key}: {formatInteger(row.count)}</p>)}</div>;
}

function ProductRankingTable({
  products,
}: {
  products: Array<{
    sku: string;
    productName: string;
    supplier: string;
    reclamations: number;
    deliveredItems: number;
    reclamationRate: number;
  }>;
}) {
  return (
    <DataTable
      columns={[
        { key: "rank", label: "#", align: "right" },
        { key: "product", label: "Artikal" },
        { key: "sku", label: "SKU" },
        { key: "supplier", label: "Dobavljač" },
        { key: "reclamations", label: "Reklamacije", align: "right" },
        { key: "delivered", label: "Isporučeno", align: "right" },
        { key: "rate", label: "% reklamacija", align: "right" },
      ]}
      rows={products.map((product, index) => ({
        id: product.sku,
        cells: {
          rank: index + 1,
          product: (
            <span className="font-medium text-ink-900">
              {product.productName}
            </span>
          ),
          sku: <span className="font-mono text-xs">{product.sku}</span>,
          supplier: product.supplier,
          reclamations: formatInteger(product.reclamations),
          delivered: formatInteger(product.deliveredItems),
          rate: formatPercent(product.reclamationRate),
        },
      }))}
      empty="Nema reklamiranih artikala."
    />
  );
}

function formatInteger(value: number) {
  return value.toLocaleString("sr-Latn-RS");
}

function formatPercent(value: number) {
  return `${value.toLocaleString("sr-Latn-RS", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
}

function formatDays(value: number | null) {
  return value === null ? "—" : `${value.toLocaleString("sr-Latn-RS", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dana`;
}
