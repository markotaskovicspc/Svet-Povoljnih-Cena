import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { importSupplier } from "@/lib/xml";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/admin/data-table";
import { SubmitButton } from "@/components/admin/submit-button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "XML import",
  robots: { index: false, follow: false },
};

async function saveSupplier(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["OPS"], action: "supplier.save", entity: "Supplier" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "") || null;
        const name = String(formData.get("name") ?? "").trim();
        const feedUrl = String(formData.get("feedUrl") ?? "").trim() || null;
        const authUser = String(formData.get("authUser") ?? "").trim() || null;
        const authPass = String(formData.get("authPass") ?? "").trim() || null;
        const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "true";
        const notes = String(formData.get("notes") ?? "").trim() || null;
        const mappingRaw = String(formData.get("mapping") ?? "").trim();
        if (!name) return { ok: false as const, error: "Naziv je obavezan." };
        let mapping: object | null = null;
        if (mappingRaw) {
          try {
            mapping = JSON.parse(mappingRaw);
          } catch {
            return { ok: false as const, error: "Mapping mora biti validan JSON." };
          }
        }
        const data = {
          name,
          feedUrl,
          authUser,
          authPass,
          enabled,
          notes,
          mapping: (mapping ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        };
        const res = id
          ? await db.supplier.update({ where: { id }, data })
          : await db.supplier.create({ data });
        revalidatePath("/admin/xml-import");
        return { ok: true as const, entityId: res.id, diff: { name, enabled } };
      },
  )(formData);
}

async function triggerImport(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["OPS"], action: "supplier.import", entity: "Supplier" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        if (!id) return { ok: false as const, error: "Nedostaje ID dobavljača." };
        const dryRun = formData.get("dryRun") === "on" || formData.get("dryRun") === "true";
        const summary = await importSupplier(id, { dryRun });
        revalidatePath("/admin/xml-import");
        return {
          ok: true as const,
          entityId: id,
          diff: { dryRun, summary } as unknown as Record<string, unknown>,
        };
      },
  )(formData);
}

function formatRunErrors(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value
    .slice(0, 3)
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return String(item);
      const record = item as Record<string, Prisma.JsonValue>;
      const externalId = typeof record.externalId === "string" ? `${record.externalId}: ` : "";
      const message = typeof record.message === "string" ? record.message : JSON.stringify(record);
      return `${externalId}${message}`;
    })
    .join("\n");
}

export default async function XmlImportPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const sp = await searchParams;
  const [suppliers, edit, recentRuns] = await Promise.all([
    db.supplier.findMany({ orderBy: { name: "asc" } }),
    sp.supplier
      ? db.supplier.findUnique({ where: { id: sp.supplier } })
      : Promise.resolve(null),
    db.importRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { supplier: { select: { name: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="XML import"
        description={`${suppliers.length} dobavljača · ${recentRuns.length} skorih run-ova`}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "XML feed" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardTitle>Dobavljači</CardTitle>
            <DataTable
              columns={[
                { key: "name", label: "Naziv" },
                { key: "feed", label: "Feed" },
                { key: "enabled", label: "Aktivan" },
                { key: "actions", label: "" },
              ]}
              rows={suppliers.map((s) => ({
                id: s.id,
                cells: {
                  name: s.name,
                  feed: s.feedUrl ? (
                    <span className="line-clamp-1 max-w-md font-mono text-xs text-ink-500">
                      {s.feedUrl}
                    </span>
                  ) : "—",
                  enabled: s.enabled ? "Da" : "Ne",
                  actions: (
                    <div className="flex flex-wrap gap-2">
                      <a href={`?supplier=${s.id}`} className="text-xs text-walnut hover:underline">
                        Izmeni
                      </a>
                      <form action={triggerImport}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="dryRun" value="true" />
                        <SubmitButton size="sm" variant="secondary" pendingLabel="Proveravam…">
                          Preview
                        </SubmitButton>
                      </form>
                      <form action={triggerImport}>
                        <input type="hidden" name="id" value={s.id} />
                        <SubmitButton size="sm" pendingLabel="Importujem…">Pokreni import</SubmitButton>
                      </form>
                    </div>
                  ),
                },
              }))}
              empty="Nema dobavljača."
            />
          </Card>

          <Card>
            <CardTitle>Poslednji import-ovi</CardTitle>
            <DataTable
              columns={[
                { key: "supplier", label: "Dobavljač" },
                { key: "mode", label: "Mod" },
                { key: "started", label: "Početak" },
                { key: "duration", label: "Trajanje" },
                { key: "status", label: "Status" },
                { key: "stats", label: "OK / Fail / Total", align: "right" },
                { key: "error", label: "Greška" },
              ]}
              rows={recentRuns.map((r) => ({
                id: r.id,
                cells: {
                  supplier: r.supplier.name,
                  mode: r.dryRun ? "Preview" : "Import",
                  started: r.startedAt.toLocaleString("sr-Latn-RS"),
                  duration: r.finishedAt
                    ? `${Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)}s`
                    : "—",
                  status: (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        r.status === "SUCCESS"
                          ? "bg-success/15 text-success"
                          : r.status === "FAILED"
                            ? "bg-destructive/15 text-destructive"
                            : r.status === "PARTIAL"
                              ? "bg-warning/15 text-warning"
                              : "bg-muted-bg text-ink-700"
                      }`}
                    >
                      {r.status}
                    </span>
                  ),
                  stats: `${r.recordsOk} / ${r.recordsFail} / ${r.recordsRead}`,
                  error: r.errorMessage || r.errors ? (
                    <span className="line-clamp-2 max-w-xs text-xs text-destructive">
                      {[r.errorMessage, formatRunErrors(r.errors)].filter(Boolean).join("\n")}
                    </span>
                  ) : "—",
                },
              }))}
              empty="Bez run-ova."
            />
          </Card>
        </div>

        <Card>
          <CardTitle>{edit ? "Izmena dobavljača" : "Novi dobavljač"}</CardTitle>
          <form action={saveSupplier} className="space-y-3">
            <input type="hidden" name="id" value={edit?.id ?? ""} />
            <Field label="Naziv">
              <Input name="name" defaultValue={edit?.name ?? ""} required />
            </Field>
            <Field label="Feed URL">
              <Input name="feedUrl" defaultValue={edit?.feedUrl ?? ""} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Auth user">
                <Input name="authUser" defaultValue={edit?.authUser ?? ""} />
              </Field>
              <Field label="Auth pass">
                <Input name="authPass" type="password" defaultValue={edit?.authPass ?? ""} />
              </Field>
            </div>
            <Field label="Aktivan">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={edit?.enabled ?? true}
                  className="size-4 accent-walnut"
                />
                Uključi u importe
              </label>
            </Field>
            <Field label="Mapping (JSON)">
              <Textarea
                name="mapping"
                rows={6}
                defaultValue={edit?.mapping ? JSON.stringify(edit.mapping, null, 2) : ""}
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Napomene">
              <Textarea name="notes" rows={2} defaultValue={edit?.notes ?? ""} />
            </Field>
            <div className="flex justify-end">
              <SubmitButton size="sm">{edit ? "Sačuvaj" : "Kreiraj"}</SubmitButton>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
