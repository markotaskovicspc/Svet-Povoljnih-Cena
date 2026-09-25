import { AnanasSummary } from "@/components/admin/ananas-summary";
import { db } from "@/lib/db";
import { Suspense } from "react";
import { getDashboardOperations, type DashboardDataInput, type DashboardOperations } from "@/lib/admin/dashboard-data";
import { getDashboardAnalytics } from "@/lib/admin/dashboard-analytics";
import { requireAdminAction } from "@/lib/admin";
import { formatRsd } from "@/lib/format";
import { resolveReportPeriod } from "@/lib/admin/report-period";
import {
  cleanDashboardContext,
  dashboardContextFromSavedColumns,
  hasDashboardContext,
  resolveDashboardFilters,
  type DashboardFilterContext,
} from "@/lib/admin/dashboard-context";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { DashboardFilters } from "@/components/admin/dashboard-filters";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kontrolna tabla",
  robots: { index: false, follow: false },
};

type DashboardParams = Partial<DashboardFilterContext> & { forbidden?: string };

function formatVolume(value: number) {
  return `${value.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })} m³`;
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<DashboardParams>;
}) {
  const admin = await requireAdminAction();
  const sp = await searchParams;
  return (
    <>
      <PageHeader
        title="Kontrolna tabla"
        description="Dnevni pregled, sačuvani poslovni periodi i jedinstven magacinski kontekst."
      />
      <Suspense fallback={<DashboardPending label="Učitavanje filtera…" />}>
        <DashboardBody adminId={admin.id} sp={sp} canViewAnanas={admin.role === "OPS" || admin.role === "SUPER"} />
      </Suspense>
    </>
  );
}

function DashboardPending({ label }: { label: string }) {
  return <div role="status" className="rounded-xl border border-border/60 bg-surface p-6 text-sm text-ink-500">{label}</div>;
}

async function DashboardBody({ adminId, sp, canViewAnanas }: { adminId: string; sp: DashboardParams; canViewAnanas: boolean }) {
  const explicitContext = cleanDashboardContext(sp);
  const hasExplicitContext = hasDashboardContext(sp);

  const [warehouses, defaultView] = await Promise.all([
    db.warehouse.findMany({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    hasExplicitContext
      ? Promise.resolve(null)
      : db.adminSavedView.findFirst({
          where: {
            adminUserId: adminId,
            module: "dashboard",
            isDefault: true,
          },
          orderBy: { updatedAt: "desc" },
          select: { columns: true },
        }),
  ]);

  const savedContext = dashboardContextFromSavedColumns(defaultView?.columns);
  const now = new Date();
  const resolved = resolveDashboardFilters(
    hasExplicitContext ? explicitContext : savedContext,
    now,
  );
  const warehouseId = warehouses.some(
    (warehouse) => warehouse.id === resolved.context.warehouseId,
  )
    ? resolved.context.warehouseId
    : "";
  const context: DashboardFilterContext = {
    ...resolved.context,
    warehouseId,
  };
  const {
    orders: ordersPeriod,
    fiscal: fiscalPeriod,
    reclamations: reclamationsPeriod,
    topProducts: topProductsPeriod,
    analytics: analyticsPeriod,
  } = resolved.periods;
  const todayPeriod = resolveReportPeriod({ range: "today" }, now);
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === warehouseId);
  const warehouseLabel = selectedWarehouse?.name ?? "Svi magacini";

  const input: DashboardDataInput = {
    now, warehouseId, todayPeriod, ordersPeriod, fiscalPeriod,
    reclamationsPeriod, topProductsPeriod, analyticsPeriod,
  };
  const operations = getDashboardOperations(input);
  const analytics = getDashboardAnalytics(input);
  const sectionKey = JSON.stringify(context);
  const exportWarehouse = warehouseId
    ? `&warehouseId=${encodeURIComponent(warehouseId)}`
    : "";
  const orderExport = `/api/admin/erp/prodajni-nalozi/export?from=${context.ordersFrom}&to=${context.ordersTo}${exportWarehouse}`;
  const fiscalExport = `/api/admin/erp/prodajni-nalozi/export?from=${context.fiscalFrom}&to=${context.fiscalTo}&dateField=fiscal-issued-at&fiscalStatus=issued${exportWarehouse}`;

  return (
      <div className="space-y-8 px-8 py-6">
        {sp.forbidden ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink-700">
            Nemate ovlašćenja za tu sekciju.
          </div>
        ) : null}

        <DashboardFilters context={context} warehouses={warehouses} />

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <a href={orderExport} className="rounded-lg border border-border px-3 py-2 text-sm text-ink-700">
              XLSX porudžbine
            </a>
            <a href={fiscalExport} className="rounded-lg border border-border px-3 py-2 text-sm text-ink-700">
              XLSX fiskalizovane porudžbine
            </a>
          </div>
          <p className="text-xs text-ink-500">
            Fiskalizovani XLSX prati izdate prodajne dokumente; refundacije umanjuju neto kartice, ali nisu zasebni redovi izvoza porudžbina.
          </p>
        </div>

        {canViewAnanas && <Suspense fallback={<DashboardPending label="Učitavanje Ananas pregleda…" />}><AnanasSummary period={fiscalPeriod} /></Suspense>}
        <section aria-label="Ključni pokazatelji" className="space-y-8">
          <Suspense key={`operations-${sectionKey}`} fallback={<DashboardPending label="Učitavanje porudžbina i zaliha…" />}>
            <OperationalCards data={operations} input={input} warehouseLabel={warehouseLabel} />
          </Suspense>
          <Suspense key={`analytics-${sectionKey}`} fallback={<DashboardPending label="Učitavanje poseta i konverzija…" />}>
            <AnalyticsCards data={analytics} periodLabel={analyticsPeriod.label} />
          </Suspense>
        </section>
        <Suspense key={`tables-${sectionKey}`} fallback={<DashboardPending label="Učitavanje pregleda magacina i artikala…" />}>
          <OperationalTables data={operations} input={input} warehouseLabel={warehouseLabel} />
        </Suspense>
      </div>
  );
}

type OperationalSectionProps = {
  data: Promise<DashboardOperations>;
  input: DashboardDataInput;
  warehouseLabel: string;
};

async function OperationalCards({ data, input, warehouseLabel }: OperationalSectionProps) {
  const { warehouseId, ordersPeriod, fiscalPeriod, reclamationsPeriod } = input;
  const { orderSummary, fiscalRows, reclamationCount, reclamationQuantity, reclamationDeliveredQuantity, warehouseStockRows, incomingRows } = await data;
  const reclamationRate = reclamationDeliveredQuantity > 0
    ? `${((reclamationQuantity / reclamationDeliveredQuantity) * 100).toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })}%`
    : "—";
  const reclamationRatioHint = reclamationDeliveredQuantity > 0
    ? `${reclamationQuantity.toLocaleString("sr-Latn-RS")} reklamiranih / ${reclamationDeliveredQuantity.toLocaleString("sr-Latn-RS")} isporučenih komada`
    : `${reclamationQuantity.toLocaleString("sr-Latn-RS")} reklamiranih komada · Nema isporučenih komada u periodu`;
  const fiscal = fiscalRows[0] ?? { today_net: 0, period_net: 0 };
  const ordersToday = orderSummary.today_count;
  const ordersTodayAmount = orderSummary.today_total;
  const ordersInPeriod = orderSummary.period_count;
  const ordersInPeriodAmount = orderSummary.period_total;
  const incoming = incomingRows[0] ?? {
    order_count: 0,
    remaining_qty: 0,
    value_rsd: 0,
    total_volume: 0,
  };
  const totalStock = warehouseStockRows.reduce(
    (total, row) => ({
      total_qty: total.total_qty + row.total_qty,
      stock_value: total.stock_value + row.stock_value,
      total_volume: total.total_volume + row.total_volume,
    }),
    { total_qty: 0, stock_value: 0, total_volume: 0 },
  );
  const visibleWarehouseStock = warehouseId
    ? warehouseStockRows.filter((row) => row.id === warehouseId)
    : warehouseStockRows;
  const visiblePallets = visibleWarehouseStock.reduce(
    (total, row) => ({
      occupied: total.occupied + row.occupied_pallet_places,
      missingSkuCount: total.missingSkuCount + row.missing_pallet_sku_count,
    }),
    { occupied: 0, missingSkuCount: 0 },
  );
  return <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Porudžbine danas" value={String(ordersToday)} amount={formatRsd(ordersTodayAmount)} breakdown={[
              { label: `SPC · ${ordersToday - (orderSummary.today_ananas ?? 0)} porudžbina`, value: formatRsd(ordersTodayAmount - (orderSummary.today_ananas_total ?? 0)) },
              { label: `Ananas · ${orderSummary.today_ananas ?? 0} porudžbina`, value: formatRsd(orderSummary.today_ananas_total ?? 0) },
              { label: "SPC dostava (odvojeno)", value: formatRsd(orderSummary.today_shipping) },
              { label: "Ananas dostava (odvojeno)", value: formatRsd(orderSummary.today_ananas_shipping ?? 0) },
            ]} hint={`Bez otkazanih · Vrednost robe bez dostave · ${warehouseLabel}${warehouseId ? " · Uvezeni Ananas podaci dostupni su za sve magacine zajedno" : ""}`} />
            <StatCard label="Porudžbine u periodu" value={String(ordersInPeriod)} amount={formatRsd(ordersInPeriodAmount)} breakdown={[
              { label: `SPC · ${ordersInPeriod - (orderSummary.period_ananas ?? 0)} porudžbina`, value: formatRsd(ordersInPeriodAmount - (orderSummary.period_ananas_total ?? 0)) },
              { label: `Ananas · ${orderSummary.period_ananas ?? 0} porudžbina`, value: formatRsd(orderSummary.period_ananas_total ?? 0) },
              { label: "SPC dostava (odvojeno)", value: formatRsd(orderSummary.period_shipping) },
              { label: "Ananas dostava (odvojeno)", value: formatRsd(orderSummary.period_ananas_shipping ?? 0) },
            ]} hint={`Bez otkazanih · Vrednost robe bez dostave · ${ordersPeriod.label} · ${warehouseLabel}`} />
            <StatCard label="Promet danas (neto fiskalizovano)" value={formatRsd(fiscal.today_net)} hint={warehouseLabel} />
            <StatCard label="Promet u periodu (neto fiskalizovano)" value={formatRsd(fiscal.period_net)} hint={`${fiscalPeriod.label} · ${warehouseLabel}`} />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Reklamacije u periodu"
              value={String(reclamationCount)}
              amount={`${reclamationRate} reklamiranih komada`}
              hint={`${reclamationRatioHint} · ${reclamationsPeriod.label} · ${warehouseLabel}`}
              tone={reclamationCount > 0 ? "warning" : "default"}
            />
            <StatCard label="Ukupne zalihe po COGS-u" value={formatRsd(totalStock.stock_value)} hint={`${totalStock.total_qty} kom · ${formatVolume(totalStock.total_volume)} · svi aktivni magacini`} />
            <StatCard
              label="Zauzeta paletna mesta"
              value={visiblePallets.occupied.toLocaleString("sr-Latn-RS")}
              hint={`${visiblePallets.missingSkuCount} SKU bez podatka kom/paleta · ${warehouseLabel}`}
              tone={visiblePallets.missingSkuCount > 0 ? "warning" : "default"}
            />
            <StatCard label="Roba u dolasku" value={formatRsd(incoming.value_rsd)} hint={`${incoming.remaining_qty} kom · ${formatVolume(incoming.total_volume)} · ${warehouseLabel}`} />
          </div>

  </>;
}

async function AnalyticsCards({ data, periodLabel }: {
  data: ReturnType<typeof getDashboardAnalytics>;
  periodLabel: string;
}) {
  const { visitRows, conversionRows, checkedAt } = await data;
  const visits = visitRows[0] ?? {
    active_now: 0,
    today: 0,
    daily_average_30d: 0,
  };
  const conversions = conversionRows[0] ?? {
    visitors: 0,
    purchasers: 0,
    purchase_value: 0,
    cart_buyers: 0,
    converted_cart_buyers: 0,
  };
  const visitPurchaseConversion = conversions.visitors
    ? (conversions.purchasers / conversions.visitors) * 100
    : 0;
  const valuePerVisit = conversions.visitors
    ? conversions.purchase_value / conversions.visitors
    : 0;
  const cartPurchaseConversion = conversions.cart_buyers
    ? (conversions.converted_cart_buyers / conversions.cart_buyers) * 100
    : 0;
  const checkedAtLabel = new Intl.DateTimeFormat("sr-Latn-RS", {
    timeZone: "Europe/Belgrade", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date(checkedAt));
  return <div className="space-y-4">
    <p className="text-xs text-ink-500">Analitika: presek u {checkedAtLabel} · podaci mogu kasniti do 30 sekundi.</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard label="Trenutni broj poseta" value={String(visits.active_now)} hint="Jedinstvene consented sesije u poslednjih 5 minuta" />
            <StatCard label="Današnji broj poseta" value={String(visits.today)} hint="Jedinstvene consented sesije danas" />
            <StatCard label="Prosečan dnevni broj poseta" value={visits.daily_average_30d.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 1 })} hint="Poslednjih 30 kalendarskih dana, uključujući dane bez poseta" />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard label="Poseta → kupovina" value={`${visitPurchaseConversion.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })}%`} hint={`${conversions.purchasers} kupaca / ${conversions.visitors} posetilaca · ${periodLabel}`} />
            <StatCard label="Poseta → vrednost" value={formatRsd(valuePerVisit)} hint={`${formatRsd(conversions.purchase_value)} atribuirane vrednosti · ${periodLabel}`} />
            <StatCard label="Korpa → kupovina" value={`${cartPurchaseConversion.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })}%`} hint={`${conversions.converted_cart_buyers} / ${conversions.cart_buyers} kupaca · ${periodLabel}`} />
          </div>
  </div>;
}

async function OperationalTables({ data, input, warehouseLabel }: OperationalSectionProps) {
  const { warehouseId, topProductsPeriod } = input;
  const { warehouseStockRows, topProducts, lowStock } = await data;
  const visibleWarehouseStock = warehouseId
    ? warehouseStockRows.filter((row) => row.id === warehouseId)
    : warehouseStockRows;
  return <>
        <Card>
          <CardTitle
            description={`${warehouseId ? `Prikazan je magacin ${warehouseLabel}.` : "Prikazani su svi aktivni magacini."} Zapremina koristi 69 m³ ÷ komada u kontejneru; ako taj podatak ne postoji, koristi Š × D × V transportnog pakovanja ÷ 1.000.000 ÷ komada u paketu. Dimenzije pojedinačnog pakovanja se ne koriste. Paletna mesta = zbir zaokruženog naviše odnosa stanje ÷ komada na paleti, zasebno po SKU-u.`}
          >
            Zalihe za magacin
          </CardTitle>
          <DataTable
            columns={[
              { key: "warehouse", label: "Magacin" },
              { key: "skus", label: "SKU-ova", align: "right" },
              { key: "qty", label: "Komada", align: "right" },
              { key: "value", label: "COGS vrednost", align: "right" },
              { key: "volume", label: "Zapremina", align: "right" },
              { key: "pallets", label: "Paletna mesta", align: "right" },
              { key: "missingPallets", label: "SKU bez kom/paleta", align: "right" },
            ]}
            rows={visibleWarehouseStock.map((row) => ({
              id: row.id,
              cells: {
                warehouse: `${row.name} (${row.code})`,
                skus: row.sku_count,
                qty: row.total_qty,
                value: formatRsd(row.stock_value),
                volume: formatVolume(row.total_volume),
                pallets: row.occupied_pallet_places.toLocaleString("sr-Latn-RS"),
                missingPallets: row.missing_pallet_sku_count,
              },
            }))}
            empty="Nema aktivnih magacina."
          />
        </Card>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardTitle description={`${topProductsPeriod.label} · ${warehouseLabel} · Po finansijskoj vrednosti, opadajuće. Prodajna cena × količina, pre dodatnih popusta na porudžbinu, bez dostave i montaže.`}>
              Top proizvodi
            </CardTitle>
            <DataTable
              columns={[
                { key: "sku", label: "SKU" },
                { key: "name", label: "Naziv" },
                { key: "qty", label: "Komada", align: "right" },
                { key: "value", label: "Finansijska vrednost", align: "right" },
              ]}
              rows={topProducts.map((product) => ({
                id: `${product.sku}-${product.name}`,
                cells: {
                  sku: <span className="font-mono text-xs">{product.sku}</span>,
                  name: product.name,
                  qty: product.qty,
                  value: <span className="whitespace-nowrap font-semibold tabular-nums">{formatRsd(product.value_rsd)}</span>,
                },
              }))}
              empty="Nema neotkazanih porudžbina u periodu."
            />
          </Card>

          <Card>
            <CardTitle description={`Aktivni artikli sa stanjem ≤ 2 · ${warehouseLabel}`}>
              Niske zalihe
            </CardTitle>
            <DataTable
              columns={[
                { key: "sku", label: "SKU" },
                { key: "name", label: "Naziv" },
                { key: "stock", label: "Stanje", align: "right" },
                { key: "incoming", label: "Ulazi", align: "right" },
              ]}
              rows={lowStock.map((product) => ({
                id: product.id,
                cells: {
                  sku: <span className="font-mono text-xs">{product.sku}</span>,
                  name: product.name,
                  stock: <span className={product.qty === 0 ? "text-danger" : ""}>{product.qty}</span>,
                  incoming: product.incoming_stock,
                },
              }))}
              empty="Nema artikala sa niskim zalihama."
            />
          </Card>
        </div>
  </>;
}
