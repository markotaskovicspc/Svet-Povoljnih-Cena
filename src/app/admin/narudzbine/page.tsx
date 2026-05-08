import Link from "next/link";
import { db } from "@/lib/db";
import { Prisma, OrderStatus } from "@prisma/client";
import { requireAdminAction } from "@/lib/admin";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Narudžbine",
  robots: { index: false, follow: false },
};

const PAGE = 30;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const status = sp.status as OrderStatus | "" | undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.OrderWhereInput = {
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" as const } },
            { shipPhone: { contains: q } },
            { shipLastName: { contains: q, mode: "insensitive" as const } },
            { guestEmail: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(status && Object.values(OrderStatus).includes(status as OrderStatus)
      ? { status: status as OrderStatus }
      : {}),
  };

  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE,
      skip: (page - 1) * PAGE,
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        createdAt: true,
        shipFirstName: true,
        shipLastName: true,
        shipCity: true,
        paymentMethod: true,
      },
    }),
    db.order.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    Object.entries(extra).forEach(([k, v]) => v && params.set(k, String(v)));
    const s = params.toString();
    return `/admin/narudzbine${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Narudžbine"
        description={`${total.toLocaleString("sr-Latn-RS")} narudžbina`}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Narudžbine" }]}
      />
      <div className="space-y-4 px-8 py-6">
        <Card>
          <form className="flex flex-wrap items-end gap-3" method="get">
            <div className="flex-1 min-w-[240px]">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Pretraga (broj / ime / telefon / email)
              </label>
              <Input name="q" defaultValue={q} placeholder="SPC-2026-…" />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Status
              </label>
              <select
                name="status"
                defaultValue={status ?? ""}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                <option value="">Svi</option>
                {Object.values(OrderStatus).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
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
            { key: "number", label: "Broj" },
            { key: "date", label: "Kreirano" },
            { key: "customer", label: "Kupac" },
            { key: "city", label: "Grad" },
            { key: "method", label: "Plaćanje" },
            { key: "total", label: "Iznos", align: "right" },
            { key: "status", label: "Status" },
            { key: "actions", label: "" },
          ]}
          rows={orders.map((o) => ({
            id: o.id,
            cells: {
              number: <span className="font-mono">{o.number}</span>,
              date: o.createdAt.toLocaleString("sr-Latn-RS", {
                dateStyle: "short",
                timeStyle: "short",
              }),
              customer: `${o.shipFirstName} ${o.shipLastName}`,
              city: o.shipCity,
              method: o.paymentMethod,
              total: formatRsd(num(o.total)),
              status: <StatusPill status={o.status} />,
              actions: (
                <Link
                  href={`/admin/narudzbine/${o.id}`}
                  className="text-xs text-walnut hover:underline"
                >
                  Otvori →
                </Link>
              ),
            },
          }))}
          empty="Nema narudžbina."
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

function StatusPill({ status }: { status: OrderStatus }) {
  const tone =
    status === "OTKAZANO" || status === "VRACENO"
      ? "bg-destructive/15 text-destructive"
      : status === "ISPORUCENO"
        ? "bg-success/15 text-success"
        : status === "U_ISPORUCI" || status === "SPREMNO_ZA_ISPORUKU"
          ? "bg-info/15 text-info"
          : "bg-muted-bg text-ink-700";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${tone}`}>{status}</span>
  );
}
