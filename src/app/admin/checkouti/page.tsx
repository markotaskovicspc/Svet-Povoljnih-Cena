import Link from "next/link";
import { CheckoutSessionStatus, Prisma } from "@prisma/client";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Checkouti",
  robots: { index: false, follow: false },
};

const PAGE = 30;
const ABANDONED_AFTER_MS = 2 * 60 * 60 * 1000;

export default async function AdminCheckoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const status = sp.status?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const abandonedBefore = await getAbandonedBefore();

  const where: Prisma.CheckoutSessionWhereInput = {
    ...(q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" as const } },
            { guestEmail: { contains: q, mode: "insensitive" as const } },
            { shippingCity: { contains: q, mode: "insensitive" as const } },
            { user: { email: { contains: q, mode: "insensitive" as const } } },
            { order: { number: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
    ...statusWhere(status, abandonedBefore),
  };

  const [sessions, total] = await Promise.all([
    db.checkoutSession.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: PAGE,
      skip: (page - 1) * PAGE,
      include: {
        user: { select: { email: true } },
        order: { select: { id: true, number: true } },
      },
    }),
    db.checkoutSession.count({ where }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    Object.entries(extra).forEach(([k, v]) => v && params.set(k, String(v)));
    const s = params.toString();
    return `/admin/checkouti${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Checkouti"
        description={`${total.toLocaleString("sr-Latn-RS")} aktivnih, konvertovanih ili napuštenih pokušaja kupovine`}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Checkouti" }]}
      />
      <div className="space-y-4 px-8 py-6">
        <Card>
          <form className="flex flex-wrap items-end gap-3" method="get">
            <div className="min-w-[240px] flex-1">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Pretraga (email / grad / porudžbina / session)
              </label>
              <Input name="q" defaultValue={q} placeholder="email, SPC-2026-…" />
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
                <option value="ACTIVE">Aktivni</option>
                <option value="CONVERTED">Konvertovani</option>
                <option value="ABANDONED">Napušteni</option>
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
            { key: "updated", label: "Ažurirano" },
            { key: "customer", label: "Kupac" },
            { key: "step", label: "Korak" },
            { key: "cart", label: "Korpa" },
            { key: "method", label: "Isporuka / plaćanje" },
            { key: "status", label: "Status" },
            { key: "order", label: "Porudžbina" },
          ]}
          rows={sessions.map((session) => {
            const derivedStatus = resolveStatus(session.status, session.updatedAt);
            return {
              id: session.id,
              cells: {
                updated: session.updatedAt.toLocaleString("sr-Latn-RS", {
                  dateStyle: "short",
                  timeStyle: "short",
                }),
                customer: (
                  <div className="space-y-0.5">
                    <p>{session.user?.email ?? session.guestEmail ?? "Nepoznat kupac"}</p>
                    {session.shippingCity ? (
                      <p className="text-xs text-ink-500">{session.shippingCity}</p>
                    ) : null}
                  </div>
                ),
                step: <span className="font-mono text-xs">{session.step}</span>,
                cart: (
                  <div className="space-y-0.5 text-xs">
                    <p>
                      {session.lineCount} lin. / {session.itemQty} kom.
                    </p>
                    <p className="font-medium text-ink-900">
                      {formatRsd(num(session.cartTotal))}
                    </p>
                  </div>
                ),
                method: (
                  <span className="text-xs">
                    {session.shippingMethod ?? "—"} / {session.paymentMethod ?? "—"}
                  </span>
                ),
                status: <StatusPill status={derivedStatus} />,
                order: session.order ? (
                  <Link
                    href={`/admin/narudzbine/${session.order.id}`}
                    className="text-xs text-walnut hover:underline"
                  >
                    {session.order.number}
                  </Link>
                ) : (
                  <span className="text-xs text-ink-400">—</span>
                ),
              },
            };
          })}
          empty="Nema checkout sesija."
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

async function getAbandonedBefore() {
  return new Date(Date.now() - ABANDONED_AFTER_MS);
}

function statusWhere(
  status: string,
  abandonedBefore: Date,
): Prisma.CheckoutSessionWhereInput {
  if (status === "ACTIVE") {
    return { status: "ACTIVE", updatedAt: { gte: abandonedBefore } };
  }
  if (status === "CONVERTED") return { status: "CONVERTED" };
  if (status === "ABANDONED") {
    return {
      OR: [
        { status: "ABANDONED" },
        { status: "ACTIVE", updatedAt: { lt: abandonedBefore } },
      ],
    };
  }
  return {};
}

function resolveStatus(status: CheckoutSessionStatus, updatedAt: Date) {
  if (
    status === "ACTIVE" &&
    updatedAt.getTime() < Date.now() - ABANDONED_AFTER_MS
  ) {
    return "ABANDONED" as const;
  }
  return status;
}

function StatusPill({
  status,
}: {
  status: CheckoutSessionStatus | "ABANDONED";
}) {
  const tone =
    status === "CONVERTED"
      ? "bg-success/15 text-success"
      : status === "ABANDONED"
        ? "bg-action/15 text-action"
        : "bg-info/15 text-info";
  const label =
    status === "CONVERTED"
      ? "Konvertovan"
      : status === "ABANDONED"
        ? "Napušten"
        : "Aktivan";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${tone}`}>
      {label}
    </span>
  );
}
