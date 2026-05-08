import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { Input } from "@/components/ui/input";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Audit log",
  robots: { index: false, follow: false },
};

const PAGE = 50;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; entity?: string; page?: string }>;
}) {
  // SUPER only — others get redirect
  await requireAdminAction([]);
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const entity = sp.entity?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.AuditLogWhereInput = {
    ...(q
      ? {
          OR: [
            { action: { contains: q, mode: "insensitive" as const } },
            { entityId: { contains: q } },
          ],
        }
      : {}),
    ...(entity ? { entity } : {}),
  };

  const [rows, total, distinctEntities] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE,
      skip: (page - 1) * PAGE,
      include: { actor: { select: { email: true, firstName: true, lastName: true } } },
    }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      distinct: ["entity"],
      select: { entity: true },
      take: 50,
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (entity) params.set("entity", entity);
    Object.entries(extra).forEach(([k, v]) => v && params.set(k, String(v)));
    const s = params.toString();
    return `/admin/audit-log${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description={`${total.toLocaleString("sr-Latn-RS")} zapisa · samo SUPER administrator`}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Audit" }]}
      />
      <div className="space-y-4 px-8 py-6">
        <Card>
          <form className="flex flex-wrap items-end gap-3" method="get">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Pretraga (action / entityId)
              </label>
              <Input name="q" defaultValue={q} />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Entitet
              </label>
              <select
                name="entity"
                defaultValue={entity}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                <option value="">Svi</option>
                {distinctEntities.map((e) => (
                  <option key={e.entity} value={e.entity}>{e.entity}</option>
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

        <Card>
          <DataTable
            columns={[
              { key: "ts", label: "Vreme" },
              { key: "actor", label: "Korisnik" },
              { key: "action", label: "Action" },
              { key: "entity", label: "Entitet" },
              { key: "entityId", label: "ID" },
              { key: "ip", label: "IP" },
              { key: "diff", label: "Diff" },
            ]}
            rows={rows.map((r) => ({
              id: r.id,
              cells: {
                ts: r.createdAt.toLocaleString("sr-Latn-RS"),
                actor: r.actor
                  ? `${r.actor.firstName ?? ""} ${r.actor.lastName ?? ""} (${r.actor.email})`.trim()
                  : "—",
                action: <span className="font-mono text-xs">{r.action}</span>,
                entity: r.entity,
                entityId: r.entityId ? <span className="font-mono text-xs">{r.entityId}</span> : "—",
                ip: r.ip ?? "—",
                diff: r.diff ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-walnut">Pregledaj</summary>
                    <pre className="mt-2 max-w-md overflow-auto rounded bg-muted-bg p-2 text-[10px]">
                      {JSON.stringify(r.diff, null, 2)}
                    </pre>
                  </details>
                ) : "—",
              },
            }))}
            empty="Nema audit zapisa."
          />
        </Card>

        {pages > 1 ? (
          <div className="flex items-center justify-between text-sm text-ink-500">
            <span>Strana {page} od {pages}</span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link href={link({ page: page - 1 })} className="rounded-md border border-border px-3 py-1 hover:bg-muted-bg">
                  ← Prethodna
                </Link>
              ) : null}
              {page < pages ? (
                <Link href={link({ page: page + 1 })} className="rounded-md border border-border px-3 py-1 hover:bg-muted-bg">
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
