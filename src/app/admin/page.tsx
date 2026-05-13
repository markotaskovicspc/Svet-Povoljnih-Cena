import { db } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kontrolna tabla",
  robots: { index: false, follow: false },
};

async function getDashboardData(dayStart: Date, monthStart: Date) {
  const [
    todayAgg,
    todayCount,
    monthAgg,
    openOrders,
    openReclamations,
    pendingComments,
    lowStock,
    lastImports,
    topProducts,
  ] = await Promise.all([
    db.order.aggregate({
      _sum: { total: true },
      where: { createdAt: { gte: dayStart }, status: { not: "OTKAZANO" } },
    }),
    db.order.count({
      where: { createdAt: { gte: dayStart } },
    }),
    db.order.aggregate({
      _sum: { total: true },
      _count: true,
      where: { createdAt: { gte: monthStart }, status: { not: "OTKAZANO" } },
    }),
    db.order.count({
      where: {
        status: { in: ["KREIRANO", "POTVRDJENO", "U_PRIPREMI"] },
      },
    }),
    db.reclamation.count({
      where: { status: { in: ["PRIMLJENO", "U_OBRADI"] } },
    }),
    db.comment.count({ where: { reviewed: false } }),
    db.product.findMany({
      where: {
        isActive: true,
        stock: { lte: 2 },
      },
      orderBy: { stock: "asc" },
      take: 8,
      select: { id: true, sku: true, name: true, stock: true, incomingStock: true },
    }),
    db.importRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 5,
      include: { supplier: { select: { name: true } } },
    }),
    db.orderItem.groupBy({
      by: ["sku", "name"],
      _sum: { qty: true },
      where: { order: { createdAt: { gte: monthStart }, status: { not: "OTKAZANO" } } },
      orderBy: { _sum: { qty: "desc" } },
      take: 5,
    }),
  ]);

  return {
    todayAgg,
    todayCount,
    monthAgg,
    openOrders,
    openReclamations,
    pendingComments,
    lowStock,
    lastImports,
    topProducts,
  };
}

function getEmptyDashboardData() {
  return {
    todayAgg: { _sum: { total: null } },
    todayCount: 0,
    monthAgg: { _sum: { total: null }, _count: 0 },
    openOrders: 0,
    openReclamations: 0,
    pendingComments: 0,
    lowStock: [],
    lastImports: [],
    topProducts: [],
  };
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ forbidden?: string }>;
}) {
  await requireAdminAction();
  const sp = await searchParams;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);

  const isPreviewMode = !process.env.DATABASE_URL;
  const {
    todayAgg,
    todayCount,
    monthAgg,
    openOrders,
    openReclamations,
    pendingComments,
    lowStock,
    lastImports,
    topProducts,
  } = isPreviewMode
    ? getEmptyDashboardData()
    : await getDashboardData(dayStart, monthStart);

  return (
    <>
      <PageHeader
        title="Kontrolna tabla"
        description="Pregled prodaje, narudžbina i stanja zaliha u realnom vremenu."
      />
      <div className="space-y-8 px-8 py-6">
        {sp.forbidden ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink-700">
            Nemate ovlašćenja za tu sekciju.
          </div>
        ) : null}
        {isPreviewMode ? (
          <div className="rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-sm text-ink-700">
            Admin panel radi u preview režimu jer DATABASE_URL nije podešen.
            Povežite bazu za realne podatke.
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Promet danas"
            value={formatRsd(num(todayAgg._sum.total))}
            hint={`${todayCount} narudžbina`}
          />
          <StatCard
            label="Promet u mesecu"
            value={formatRsd(num(monthAgg._sum.total))}
            hint={`${monthAgg._count} narudžbina`}
          />
          <StatCard
            label="Otvorene narudžbine"
            value={String(openOrders)}
            hint="KREIRANO + POTVRDJENO + U_PRIPREMI"
            tone={openOrders > 10 ? "warning" : "default"}
          />
          <StatCard
            label="Reklamacije / komentari"
            value={`${openReclamations} / ${pendingComments}`}
            hint="Aktivne reklamacije i nepregledani komentari"
            tone={openReclamations > 0 ? "danger" : "default"}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardTitle description="Najprodavanije u tekućem mesecu">
              Top proizvodi
            </CardTitle>
            <DataTable
              columns={[
                { key: "sku", label: "SKU" },
                { key: "name", label: "Naziv" },
                { key: "qty", label: "Komada", align: "right" },
              ]}
              rows={topProducts.map((p) => ({
                id: p.sku,
                cells: {
                  sku: <span className="font-mono text-xs">{p.sku}</span>,
                  name: p.name,
                  qty: p._sum.qty ?? 0,
                },
              }))}
              empty="Još nema prodaje u ovom mesecu."
            />
          </Card>

          <Card>
            <CardTitle description="Aktivni proizvodi sa stanjem ≤ 2">
              Niske zalihe
            </CardTitle>
            <DataTable
              columns={[
                { key: "sku", label: "SKU" },
                { key: "name", label: "Naziv" },
                { key: "stock", label: "Stanje", align: "right" },
                { key: "incoming", label: "Ulazi", align: "right" },
              ]}
              rows={lowStock.map((p) => ({
                id: p.id,
                cells: {
                  sku: <span className="font-mono text-xs">{p.sku}</span>,
                  name: p.name,
                  stock: (
                    <span className={p.stock === 0 ? "text-danger" : ""}>
                      {p.stock}
                    </span>
                  ),
                  incoming: p.incomingStock,
                },
              }))}
              empty="Sve je u redu — nema niskih zaliha."
            />
          </Card>
        </div>

        <Card>
          <CardTitle description="Poslednjih 5 pokretanja XML feed importera">
            Status feed-a
          </CardTitle>
          <DataTable
            columns={[
              { key: "supplier", label: "Dobavljač" },
              { key: "started", label: "Pokrenuto" },
              { key: "status", label: "Status" },
              { key: "ok", label: "OK", align: "right" },
              { key: "fail", label: "Grešaka", align: "right" },
            ]}
            rows={lastImports.map((r) => ({
              id: r.id,
              cells: {
                supplier: r.supplier?.name ?? "—",
                started: new Intl.DateTimeFormat("sr-Latn-RS", {
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(r.startedAt),
                status: (
                  <span
                    className={
                      r.status === "FAILED"
                        ? "text-danger"
                        : r.status === "PARTIAL"
                          ? "text-warning"
                          : r.status === "RUNNING"
                            ? "text-info"
                            : "text-success"
                    }
                  >
                    {r.status}
                  </span>
                ),
                ok: r.recordsOk,
                fail: r.recordsFail,
              },
            }))}
            empty="Importer još nije pokrenut."
          />
        </Card>
      </div>
    </>
  );
}

// Type-only re-export to silence unused import lints if Prisma types change.
export type _DashPrisma = Prisma.OrderWhereInput;
