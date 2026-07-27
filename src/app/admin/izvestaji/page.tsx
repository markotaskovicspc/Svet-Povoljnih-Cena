import Link from "next/link";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import {
  REPORT_PERIOD_PRESETS,
  resolveReportPeriod,
} from "@/lib/admin/report-period";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Izveštaji",
  robots: { index: false, follow: false },
};

type StockSummaryRow = {
  total_qty: number;
  sku_count: number;
  stock_value: number;
  total_volume: number;
};

type WarehouseStockRow = StockSummaryRow & {
  id: string;
  code: string;
  name: string;
};

type IncomingSummaryRow = {
  order_count: number;
  remaining_qty: number;
  value_rsd: number;
  total_volume: number;
};

type IncomingBreakdownRow = IncomingSummaryRow & {
  supplier: string;
  status: string;
};

const RECLAMATION_STATUS_LABELS: Record<string, string> = {
  PRIMLJENO: "Primljeno",
  U_OBRADI: "U obradi",
  RESENO: "Rešeno",
  ODBIJENO: "Odbijeno",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  await requireAdminAction(["CONTENT", "OPS", "ADS"]);
  const period = resolveReportPeriod(await searchParams);
  const periodFilter = { gte: period.start, lt: period.endExclusive };
  const fiscalSaleWhere: Prisma.FiscalDocumentWhereInput = {
    kind: "SALE",
    status: "ISSUED",
    issuedAt: periodFilter,
  };
  const fiscalLineSaleWhere: Prisma.FiscalDocumentLineWhereInput = {
    fiscalDocument: { is: fiscalSaleWhere },
  };

  const [
    fiscalSales,
    fiscalRefunds,
    fiscalOrderGroups,
    topItems,
    topCategories,
    stockSummaryRows,
    warehouseStockRows,
    incomingSummaryRows,
    incomingBreakdown,
    reclamations,
  ] = await Promise.all([
    db.fiscalDocument.aggregate({
      where: fiscalSaleWhere,
      _count: { id: true },
      _sum: { totalGross: true },
    }),
    db.fiscalDocument.aggregate({
      where: {
        kind: "REFUND",
        status: "ISSUED",
        issuedAt: periodFilter,
      },
      _count: { id: true },
      _sum: { totalGross: true },
    }),
    db.fiscalDocument.groupBy({
      by: ["orderId"],
      where: fiscalSaleWhere,
    }),
    db.fiscalDocumentLine.groupBy({
      by: ["sku", "shortName"],
      where: fiscalLineSaleWhere,
      _sum: { qty: true, totalGross: true },
      orderBy: { _sum: { qty: "desc" } },
      take: 10,
    }),
    db.fiscalDocumentLine.groupBy({
      by: ["categoryName"],
      where: fiscalLineSaleWhere,
      _sum: { qty: true, totalGross: true },
      orderBy: { _sum: { totalGross: "desc" } },
      take: 10,
    }),
    db.$queryRaw<StockSummaryRow[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(GREATEST(ws.qty, 0)), 0)::int AS total_qty,
        COUNT(DISTINCT CASE WHEN ws.qty > 0 THEN ws."productId" END)::int AS sku_count,
        COALESCE(SUM(GREATEST(ws.qty, 0) * COALESCE(p.cogs, 0)), 0)::double precision AS stock_value,
        COALESCE(SUM(
          GREATEST(ws.qty, 0)
          * COALESCE(p."widthCm" * p."depthCm" * p."heightCm" / 1000000, 0)
        ), 0)::double precision AS total_volume
      FROM "WarehouseStock" ws
      JOIN "Warehouse" w ON w.id = ws."warehouseId" AND w.active = true
      JOIN "Product" p ON p.id = ws."productId"
    `),
    db.$queryRaw<WarehouseStockRow[]>(Prisma.sql`
      SELECT
        w.id,
        w.code,
        w.name,
        COALESCE(SUM(GREATEST(ws.qty, 0)), 0)::int AS total_qty,
        COUNT(DISTINCT CASE WHEN ws.qty > 0 THEN ws."productId" END)::int AS sku_count,
        COALESCE(SUM(GREATEST(ws.qty, 0) * COALESCE(p.cogs, 0)), 0)::double precision AS stock_value,
        COALESCE(SUM(
          GREATEST(ws.qty, 0)
          * COALESCE(p."widthCm" * p."depthCm" * p."heightCm" / 1000000, 0)
        ), 0)::double precision AS total_volume
      FROM "Warehouse" w
      LEFT JOIN "WarehouseStock" ws ON ws."warehouseId" = w.id
      LEFT JOIN "Product" p ON p.id = ws."productId"
      WHERE w.active = true
      GROUP BY w.id, w.code, w.name
      ORDER BY total_qty DESC, w.name ASC
    `),
    db.$queryRaw<IncomingSummaryRow[]>(Prisma.sql`
      SELECT
        COUNT(DISTINCT po.id)::int AS order_count,
        COALESCE(SUM(GREATEST(poi.qty - poi."receivedQty", 0)), 0)::int AS remaining_qty,
        COALESCE(SUM(
          GREATEST(poi.qty - poi."receivedQty", 0)
          * poi."purchasePrice"
          * po."exchangeRate"
        ), 0)::double precision AS value_rsd,
        COALESCE(SUM(
          CASE WHEN poi.qty > 0 THEN
            COALESCE(poi."totalVolume", 0)
            * GREATEST(poi.qty - poi."receivedQty", 0)::numeric
            / poi.qty
          ELSE 0 END
        ), 0)::double precision AS total_volume
      FROM "PurchaseOrder" po
      LEFT JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po.id
      WHERE po.status IN ('SENT', 'CONFIRMED')
        AND COALESCE(po."deliveryDate", po."orderDate", po."createdAt") >= ${period.start}
        AND COALESCE(po."deliveryDate", po."orderDate", po."createdAt") < ${period.endExclusive}
    `),
    db.$queryRaw<IncomingBreakdownRow[]>(Prisma.sql`
      SELECT
        COALESCE(s.name, 'Bez dobavljača') AS supplier,
        po.status::text AS status,
        COUNT(DISTINCT po.id)::int AS order_count,
        COALESCE(SUM(GREATEST(poi.qty - poi."receivedQty", 0)), 0)::int AS remaining_qty,
        COALESCE(SUM(
          GREATEST(poi.qty - poi."receivedQty", 0)
          * poi."purchasePrice"
          * po."exchangeRate"
        ), 0)::double precision AS value_rsd,
        COALESCE(SUM(
          CASE WHEN poi.qty > 0 THEN
            COALESCE(poi."totalVolume", 0)
            * GREATEST(poi.qty - poi."receivedQty", 0)::numeric
            / poi.qty
          ELSE 0 END
        ), 0)::double precision AS total_volume
      FROM "PurchaseOrder" po
      LEFT JOIN "Supplier" s ON s.id = po."supplierId"
      LEFT JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po.id
      WHERE po.status IN ('SENT', 'CONFIRMED')
        AND COALESCE(po."deliveryDate", po."orderDate", po."createdAt") >= ${period.start}
        AND COALESCE(po."deliveryDate", po."orderDate", po."createdAt") < ${period.endExclusive}
      GROUP BY s.name, po.status
      ORDER BY value_rsd DESC, supplier ASC
    `),
    db.reclamation.findMany({
      where: { createdAt: periodFilter },
      select: {
        orderId: true,
        sku: true,
        status: true,
        decision: true,
        createdAt: true,
        resolvedAt: true,
      },
    }),
  ]);

  const stockSummary = stockSummaryRows[0] ?? {
    total_qty: 0,
    sku_count: 0,
    stock_value: 0,
    total_volume: 0,
  };
  const incomingSummary = incomingSummaryRows[0] ?? {
    order_count: 0,
    remaining_qty: 0,
    value_rsd: 0,
    total_volume: 0,
  };
  const saleGross = num(fiscalSales._sum.totalGross ?? 0);
  const refundGross = num(fiscalRefunds._sum.totalGross ?? 0);
  const netFiscalized = saleGross - refundGross;
  const uniqueReclamationOrders = new Set(reclamations.map((item) => item.orderId)).size;
  const reclamationShare = fiscalOrderGroups.length
    ? (uniqueReclamationOrders / fiscalOrderGroups.length) * 100
    : 0;
  const openReclamations = reclamations.filter(
    (item) => item.status === "PRIMLJENO" || item.status === "U_OBRADI",
  ).length;
  const acceptedReclamations = reclamations.filter(
    (item) => item.decision === "PRIHVACENA",
  ).length;
  const resolvedDurations = reclamations.flatMap((item) =>
    item.resolvedAt
      ? [(item.resolvedAt.getTime() - item.createdAt.getTime()) / 86_400_000]
      : [],
  );
  const averageResolutionDays = resolvedDurations.length
    ? resolvedDurations.reduce((sum, days) => sum + days, 0) / resolvedDurations.length
    : 0;
  const reclamationsByStatus = Object.entries(
    reclamations.reduce<Record<string, number>>((counts, item) => {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
      return counts;
    }, {}),
  ).sort(([, left], [, right]) => right - left);
  const topReclamationSkus = Object.entries(
    reclamations.reduce<Record<string, number>>((counts, item) => {
      counts[item.sku] = (counts[item.sku] ?? 0) + 1;
      return counts;
    }, {}),
  )
    .sort(([, left], [, right]) => right - left)
    .slice(0, 10);

  return (
    <>
      <PageHeader
        title="Izveštaji"
        description={period.label}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Izveštaji" }]}
      />
      <div className="space-y-10 px-8 py-6">
        <Card>
          <CardTitle description="Izaberite brzi period ili unesite tačan raspon datuma.">
            Period izveštaja
          </CardTitle>
          <div className="space-y-4">
            <nav aria-label="Brzi izbor perioda" className="flex flex-wrap gap-2 text-xs">
              {REPORT_PERIOD_PRESETS.map((preset) => (
                <Link
                  key={preset.key}
                  href={`/admin/izvestaji?range=${preset.key}`}
                  aria-current={period.preset === preset.key ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 transition ${
                    period.preset === preset.key
                      ? "bg-walnut text-white"
                      : "bg-muted-bg text-ink-700 hover:bg-muted-bg/70"
                  }`}
                >
                  {preset.label}
                </Link>
              ))}
            </nav>

            <form method="get" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="range" value="custom" />
              <div>
                <label
                  htmlFor="report-from"
                  className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500"
                >
                  Od
                </label>
                <Input
                  id="report-from"
                  name="from"
                  type="date"
                  required
                  defaultValue={period.fromInput}
                  className="h-9"
                />
              </div>
              <div>
                <label
                  htmlFor="report-to"
                  className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500"
                >
                  Do
                </label>
                <Input
                  id="report-to"
                  name="to"
                  type="date"
                  required
                  defaultValue={period.toInput}
                  className="h-9"
                />
              </div>
              <button
                type="submit"
                className="h-9 rounded-lg bg-walnut px-4 text-sm font-medium text-white transition hover:bg-walnut/90"
              >
                Prikaži period
              </button>
            </form>
          </div>
        </Card>

        <nav
          aria-label="Delovi izveštaja"
          className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
        >
          {[
            ["prodaja", "Porudžbine i prodaja"],
            ["zalihe", "Zalihe"],
            ["roba-u-dolasku", "Roba u dolasku"],
            ["reklamacije", "Reklamacije"],
          ].map(([id, label], index) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-xl border border-border/60 bg-surface px-4 py-3 text-sm text-ink-700 transition hover:border-walnut/40 hover:text-walnut"
            >
              <span className="mr-2 text-xs text-ink-500">0{index + 1}</span>
              {label}
            </a>
          ))}
        </nav>

        <ReportSection
          id="prodaja"
          number="01"
          title="Porudžbine i prodaja (Fiskalizovano)"
          description="Prikaz koristi samo izdate fiskalne račune i refundacije sa datumom izdavanja u izabranom periodu."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Fiskalizovane porudžbine"
              value={formatInteger(fiscalOrderGroups.length)}
              hint={`${formatInteger(fiscalSales._count.id)} izdatih računa`}
            />
            <StatCard label="Bruto prodaja" value={formatRsd(saleGross)} />
            <StatCard
              label="Refundacije"
              value={formatRsd(refundGross)}
              hint={`${formatInteger(fiscalRefunds._count.id)} dokumenata`}
              tone={refundGross > 0 ? "warning" : "default"}
            />
            <StatCard
              label="Neto fiskalizovano"
              value={formatRsd(netFiscalized)}
              tone={netFiscalized >= 0 ? "success" : "danger"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardTitle>Top artikli po fiskalizovanoj količini</CardTitle>
              <DataTable
                columns={[
                  { key: "sku", label: "SKU" },
                  { key: "name", label: "Naziv" },
                  { key: "qty", label: "Komada", align: "right" },
                  { key: "revenue", label: "Promet", align: "right" },
                ]}
                rows={topItems.map((item) => ({
                  id: `${item.sku}-${item.shortName}`,
                  cells: {
                    sku: <span className="font-mono text-xs">{item.sku}</span>,
                    name: item.shortName,
                    qty: formatInteger(item._sum.qty ?? 0),
                    revenue: formatRsd(num(item._sum.totalGross ?? 0)),
                  },
                }))}
                empty="Nema fiskalizovane prodaje u periodu."
              />
            </Card>

            <Card>
              <CardTitle>Top kategorije po fiskalizovanom prometu</CardTitle>
              <DataTable
                columns={[
                  { key: "category", label: "Kategorija" },
                  { key: "qty", label: "Komada", align: "right" },
                  { key: "revenue", label: "Promet", align: "right" },
                ]}
                rows={topCategories.map((item, index) => ({
                  id: `${item.categoryName ?? "bez-kategorije"}-${index}`,
                  cells: {
                    category: item.categoryName ?? "Bez kategorije",
                    qty: formatInteger(item._sum.qty ?? 0),
                    revenue: formatRsd(num(item._sum.totalGross ?? 0)),
                  },
                }))}
                empty="Nema fiskalizovane prodaje po kategorijama u periodu."
              />
            </Card>
          </div>
        </ReportSection>

        <ReportSection
          id="zalihe"
          number="02"
          title="Zalihe"
          description="Trenutno stanje aktivnih magacina; ovaj deo je presek na današnji trenutak i ne menja se izborom perioda."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Komada na stanju" value={formatInteger(stockSummary.total_qty)} />
            <StatCard label="SKU-ova na stanju" value={formatInteger(stockSummary.sku_count)} />
            <StatCard label="COGS vrednost" value={formatRsd(stockSummary.stock_value)} />
            <StatCard label="Procenjena zapremina" value={formatVolume(stockSummary.total_volume)} />
          </div>

          <Card>
            <CardTitle description="Vrednost je obračunata po trenutnom COGS-u, a m³ prema evidentiranim dimenzijama artikla.">
              Stanje po magacinu
            </CardTitle>
            <DataTable
              columns={[
                { key: "warehouse", label: "Magacin" },
                { key: "skus", label: "SKU-ova", align: "right" },
                { key: "qty", label: "Komada", align: "right" },
                { key: "value", label: "COGS vrednost", align: "right" },
                { key: "volume", label: "Zapremina", align: "right" },
              ]}
              rows={warehouseStockRows.map((row) => ({
                id: row.id,
                cells: {
                  warehouse: (
                    <div>
                      <span className="font-medium text-ink-900">{row.name}</span>
                      <span className="ml-2 font-mono text-xs text-ink-500">{row.code}</span>
                    </div>
                  ),
                  skus: formatInteger(row.sku_count),
                  qty: formatInteger(row.total_qty),
                  value: formatRsd(row.stock_value),
                  volume: formatVolume(row.total_volume),
                },
              }))}
              empty="Nema aktivnih magacina."
            />
          </Card>
        </ReportSection>

        <ReportSection
          id="roba-u-dolasku"
          number="03"
          title="Roba u dolasku"
          description="Aktivne poslate i potvrđene porudžbenice čiji je planirani datum dolaska u izabranom periodu. Ako rok nije unet, koristi se datum porudžbine ili kreiranja."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Porudžbenice" value={formatInteger(incomingSummary.order_count)} />
            <StatCard label="Preostalo komada" value={formatInteger(incomingSummary.remaining_qty)} />
            <StatCard label="Vrednost u RSD" value={formatRsd(incomingSummary.value_rsd)} />
            <StatCard label="Zapremina u dolasku" value={formatVolume(incomingSummary.total_volume)} />
          </div>

          <Card>
            <CardTitle>Po dobavljaču i statusu</CardTitle>
            <DataTable
              columns={[
                { key: "supplier", label: "Dobavljač" },
                { key: "status", label: "Status" },
                { key: "orders", label: "Porudžbenice", align: "right" },
                { key: "qty", label: "Preostalo komada", align: "right" },
                { key: "value", label: "Vrednost", align: "right" },
                { key: "volume", label: "Zapremina", align: "right" },
              ]}
              rows={incomingBreakdown.map((row, index) => ({
                id: `${row.supplier}-${row.status}-${index}`,
                cells: {
                  supplier: row.supplier,
                  status: row.status === "CONFIRMED" ? "Potvrđeno" : "Poslato",
                  orders: formatInteger(row.order_count),
                  qty: formatInteger(row.remaining_qty),
                  value: formatRsd(row.value_rsd),
                  volume: formatVolume(row.total_volume),
                },
              }))}
              empty="Nema robe u dolasku za izabrani period."
            />
          </Card>
        </ReportSection>

        <ReportSection
          id="reklamacije"
          number="04"
          title="Reklamacije"
          description="Reklamacije primljene u izabranom periodu, sa trenutnim statusom i vremenom rešavanja."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Ukupno reklamacija" value={formatInteger(reclamations.length)} />
            <StatCard
              label="Otvorene"
              value={formatInteger(openReclamations)}
              tone={openReclamations > 0 ? "warning" : "default"}
            />
            <StatCard
              label="Prihvaćene"
              value={formatInteger(acceptedReclamations)}
              hint={reclamations.length ? `${formatPercent((acceptedReclamations / reclamations.length) * 100)} svih reklamacija` : "Bez reklamacija"}
            />
            <StatCard
              label="Prosečno rešavanje"
              value={`${averageResolutionDays.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 1 })} dana`}
              hint={`${formatPercent(reclamationShare)} reklamiranih porudžbina prema fiskalizovanim u periodu`}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardTitle>Po statusu</CardTitle>
              <DataTable
                columns={[
                  { key: "status", label: "Status" },
                  { key: "count", label: "Broj", align: "right" },
                  { key: "share", label: "Udeo", align: "right" },
                ]}
                rows={reclamationsByStatus.map(([status, count]) => ({
                  id: status,
                  cells: {
                    status: RECLAMATION_STATUS_LABELS[status] ?? status,
                    count: formatInteger(count),
                    share: formatPercent((count / reclamations.length) * 100),
                  },
                }))}
                empty="Nema reklamacija u periodu."
              />
            </Card>

            <Card>
              <CardTitle>Najčešće reklamirani SKU-ovi</CardTitle>
              <DataTable
                columns={[
                  { key: "sku", label: "SKU" },
                  { key: "count", label: "Reklamacija", align: "right" },
                ]}
                rows={topReclamationSkus.map(([sku, count]) => ({
                  id: sku,
                  cells: {
                    sku: <span className="font-mono text-xs">{sku}</span>,
                    count: formatInteger(count),
                  },
                }))}
                empty="Nema reklamiranih artikala u periodu."
              />
            </Card>
          </div>
        </ReportSection>
      </div>
    </>
  );
}

function ReportSection({
  id,
  number,
  title,
  description,
  children,
}: {
  id: string;
  number: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
          {number}
        </p>
        <h2 id={`${id}-title`} className="mt-1 font-display text-2xl text-ink-900">
          {title}
        </h2>
        <p className="mt-1 max-w-4xl text-sm text-ink-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

function formatInteger(value: number) {
  return value.toLocaleString("sr-Latn-RS");
}

function formatVolume(value: number) {
  return `${value.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })} m³`;
}

function formatPercent(value: number) {
  return `${value.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 1 })}%`;
}
