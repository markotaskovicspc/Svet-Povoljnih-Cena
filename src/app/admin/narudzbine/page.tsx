import Link from "next/link";
import { db } from "@/lib/db";
import {
  Prisma,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ShipmentStatus,
} from "@prisma/client";
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
  searchParams: Promise<{
    q?: string;
    status?: string;
    paymentMethod?: string;
    paymentStatus?: string;
    shipmentStatus?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requireAdminAction(["OPS"]);
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const status = enumValue(OrderStatus, sp.status);
  const paymentMethod = enumValue(PaymentMethod, sp.paymentMethod);
  const paymentStatus = enumValue(PaymentStatus, sp.paymentStatus);
  const shipmentStatus = enumValue(ShipmentStatus, sp.shipmentStatus);
  const from = parseDateStart(sp.from);
  const to = parseDateEnd(sp.to);
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
    ...(status ? { status } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(paymentStatus ? { payments: { some: { status: paymentStatus } } } : {}),
    ...(shipmentStatus ? { shipments: { some: { status: shipmentStatus } } } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
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
        guestEmail: true,
        shipFirstName: true,
        shipLastName: true,
        shipPhone: true,
        shipCity: true,
        paymentMethod: true,
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, provider: true },
        },
        shipments: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { status: true, provider: true, trackingNo: true },
        },
      },
    }),
    db.order.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (paymentMethod) params.set("paymentMethod", paymentMethod);
    if (paymentStatus) params.set("paymentStatus", paymentStatus);
    if (shipmentStatus) params.set("shipmentStatus", shipmentStatus);
    if (sp.from) params.set("from", sp.from);
    if (sp.to) params.set("to", sp.to);
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
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Metod plaćanja
              </label>
              <select
                name="paymentMethod"
                defaultValue={paymentMethod ?? ""}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                <option value="">Svi</option>
                {Object.values(PaymentMethod).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Plaćanje
              </label>
              <select
                name="paymentStatus"
                defaultValue={paymentStatus ?? ""}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                <option value="">Sva</option>
                {Object.values(PaymentStatus).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Isporuka
              </label>
              <select
                name="shipmentStatus"
                defaultValue={shipmentStatus ?? ""}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                <option value="">Sve</option>
                {Object.values(ShipmentStatus).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Od
              </label>
              <Input name="from" type="date" defaultValue={sp.from ?? ""} className="h-8" />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Do
              </label>
              <Input name="to" type="date" defaultValue={sp.to ?? ""} className="h-8" />
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
            { key: "contact", label: "Kontakt" },
            { key: "city", label: "Grad" },
            { key: "method", label: "Plaćanje" },
            { key: "payment", label: "Status plaćanja" },
            { key: "shipment", label: "Status isporuke" },
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
              contact: (
                <div className="space-y-0.5 text-xs">
                  <div>{o.guestEmail ?? "—"}</div>
                  <div className="text-ink-500">{o.shipPhone}</div>
                </div>
              ),
              city: o.shipCity,
              method: o.paymentMethod,
              payment: o.payments[0] ? (
                <div className="space-y-0.5 text-xs">
                  <StatusPill status={o.payments[0].status} />
                  <div className="text-ink-500">{o.payments[0].provider}</div>
                </div>
              ) : (
                "—"
              ),
              shipment: o.shipments[0] ? (
                <div className="space-y-0.5 text-xs">
                  <ShipmentPill status={o.shipments[0].status} />
                  <div className="text-ink-500">
                    {[o.shipments[0].provider, o.shipments[0].trackingNo]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </div>
                </div>
              ) : (
                "—"
              ),
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

function enumValue<T extends Record<string, string>>(source: T, value?: string) {
  return Object.values(source).includes(value ?? "") ? (value as T[keyof T]) : undefined;
}

function parseDateStart(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseDateEnd(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function StatusPill({ status }: { status: OrderStatus | PaymentStatus }) {
  const tone =
    status === "OTKAZANO" || status === "VRACENO"
      ? "bg-destructive/15 text-destructive"
      : status === "ISPORUCENO" || status === "PAID"
        ? "bg-success/15 text-success"
        : status === "U_ISPORUCI" || status === "SPREMNO_ZA_ISPORUKU" || status === "AUTHORIZED"
          ? "bg-info/15 text-info"
          : status === "FAILED" || status === "REFUNDED"
            ? "bg-destructive/15 text-destructive"
          : "bg-muted-bg text-ink-700";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${tone}`}>{status}</span>
  );
}

function ShipmentPill({ status }: { status: ShipmentStatus }) {
  const tone =
    status === "DELIVERED"
      ? "bg-success/15 text-success"
      : status === "FAILED" || status === "RETURNED"
        ? "bg-destructive/15 text-destructive"
        : status === "IN_TRANSIT" || status === "OUT_FOR_DELIVERY" || status === "PICKED_UP"
          ? "bg-info/15 text-info"
          : "bg-muted-bg text-ink-700";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${tone}`}>{status}</span>
  );
}
