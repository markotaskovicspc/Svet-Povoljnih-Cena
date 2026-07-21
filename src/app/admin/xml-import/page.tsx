import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { withAdmin, withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { importSupplier } from "@/lib/xml";
import {
  syncPendingRabaluxMedia,
  syncRabaluxCatalog,
  syncRabaluxStock,
} from "@/lib/rabalux";
import {
  consumeRabaluxSyncPreview,
  createRabaluxSyncPreview,
  parseRabaluxSyncTarget,
  type RabaluxPreviewResult,
} from "@/lib/rabalux/admin-sync";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/admin/data-table";
import { SubmitButton } from "@/components/admin/submit-button";
import { RabaluxControls } from "@/components/admin/rabalux-controls";
import { AdminActionForm } from "@/components/admin/action-form";
import {
  reviewRabaluxPriceProposal,
  reviewRabaluxProduct,
  rollbackRabaluxRun,
  saveRabaluxCategoryMapping,
} from "@/lib/rabalux/governance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
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
        const existing = id
          ? await db.supplier.findUnique({
              where: { id },
              select: { integrationKey: true },
            })
          : null;
        const data = {
          name,
          ...(existing?.integrationKey === "RABALUX"
            ? {}
            : { feedUrl, authUser, authPass }),
          enabled,
          notes,
          ...(existing?.integrationKey === "RABALUX"
            ? {}
            : {
                mapping: (mapping ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              }),
        };
        const res = id
          ? await db.supplier.update({ where: { id }, data })
          : await db.supplier.create({ data });
        revalidatePath("/admin/xml-import");
        return { ok: true as const, entityId: res.id, diff: { name, enabled } };
      },
  )(formData);
}

async function saveRabaluxLoadingLocations(formData: FormData) {
  "use server";

  return withAdmin(
    {
      allowed: ["OPS"],
      action: "rabalux.loadingLocations.save",
      entity: "SupplierLoadingLocation",
    },
    async (_actorId, formData: FormData) => {
      const supplierId = String(formData.get("supplierId") ?? "");
      const supplier = await db.supplier.findFirst({
        where: { id: supplierId, integrationKey: "RABALUX" },
        select: { id: true },
      });
      if (!supplier) {
        return { ok: false as const, error: "Dobavljač nije pronađen." };
      }

      const locations = [1, 2].map((position) => ({
        position,
        address: String(formData.get(`address${position}`) ?? "").trim(),
        city: String(formData.get(`city${position}`) ?? "").trim(),
      }));
      for (const location of locations) {
        if (location.address.length > 250 || location.city.length > 120) {
          return { ok: false as const, error: "Adresa ili grad su predugački." };
        }
        if (Boolean(location.address) !== Boolean(location.city)) {
          return {
            ok: false as const,
            error: `Za lokaciju ${location.position} unesite i adresu i grad ili ostavite oba polja prazna.`,
          };
        }
      }

      await db.$transaction(
        locations.map((location) =>
          db.supplierLoadingLocation.update({
            where: {
              supplierId_position: {
                supplierId: supplier.id,
                position: location.position,
              },
            },
            data: {
              address: location.address || null,
              city: location.city || null,
            },
          }),
        ),
      );
      revalidatePath("/admin/xml-import");
      return {
        ok: true as const,
        entityId: supplier.id,
        diff: {
          locations: locations.map((location) => ({
            position: location.position,
            configured: Boolean(location.address && location.city),
          })),
        },
      };
    },
  )(formData);
}

async function previewRabalux(
  _state: AdminActionState<RabaluxPreviewResult>,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "rabalux.syncPreview", entity: "Supplier" },
    async (actorId, formData: FormData) => {
      const target = parseRabaluxSyncTarget(formData.get("target"));
      if (!target) return { ok: false as const, error: "Nepoznata akcija." };
      const preview = await createRabaluxSyncPreview(actorId, target);
      return {
        ok: true as const,
        entityId: "supplier-rabalux",
        diff: {
          target,
          expiresAt: preview.expiresAt,
          summary: preview.summary,
        },
        result: preview,
        message: "Preview je spreman. Proverite rezultat pre izvršenja.",
      };
    },
  )(formData);
}

async function executeRabalux(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "rabalux.syncExecute", entity: "Supplier" },
    async (actorId, formData: FormData) => {
      const target = parseRabaluxSyncTarget(formData.get("target"));
      if (!target) return { ok: false as const, error: "Nepoznata akcija." };
      const reason = String(formData.get("reason") ?? "").trim();
      const token = String(formData.get("token") ?? "");
      const phrase = String(formData.get("phrase") ?? "");
      const confirmation = await consumeRabaluxSyncPreview({
        actorId,
        target,
        token,
        phrase,
        reason,
      });
      const result =
        target === "catalog"
          ? await syncRabaluxCatalog({
              expectedSourceHash: confirmation.sourceHash ?? undefined,
              previewRunId: confirmation.runId,
              requestedById: actorId,
              reason,
              allowRiskyPrices: true,
              allowLargeRemoval: true,
            })
          : target === "stock"
            ? await syncRabaluxStock({
                expectedSourceHash: confirmation.sourceHash ?? undefined,
                previewRunId: confirmation.runId,
                requestedById: actorId,
                reason,
                allowLargeRemoval: true,
              })
            : await syncPendingRabaluxMedia(100, {
                expectedSourceHash: confirmation.sourceHash ?? undefined,
                previewRunId: confirmation.runId,
                requestedById: actorId,
                reason,
              });
      revalidatePath("/admin/xml-import");
      return {
        ok: true as const,
        entityId: "supplier-rabalux",
        diff: {
          target,
          reason,
          previewRunId: confirmation.runId,
          result,
        } as unknown as Record<string, unknown>,
        message: "Akcija je prihvaćena i rezultat je zabeležen.",
      };
    },
  )(formData);
}

async function saveRabaluxMapping(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "rabalux.mapping.save", entity: "SupplierCategoryMapping" },
    async (actorId, formData: FormData) => {
      const result = await saveRabaluxCategoryMapping({
        actorId,
        externalCategory: String(formData.get("externalCategory") ?? ""),
        externalType: String(formData.get("externalType") ?? ""),
        categoryId: String(formData.get("categoryId") ?? ""),
      });
      revalidatePath("/admin/xml-import");
      return {
        ok: true as const,
        entityId: result.mappingId,
        diff: result,
        message: `Mapiranje je sačuvano; ${result.affectedProducts} proizvod(a) čeka odobrenje.`,
      };
    },
  )(formData);
}

async function reviewRabaluxProductAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "rabalux.product.review", entity: "Product" },
    async (actorId, formData: FormData) => {
      const decision = String(formData.get("decision") ?? "");
      if (decision !== "APPROVE" && decision !== "REJECT") {
        return { ok: false as const, error: "Nepoznata odluka." };
      }
      const result = await reviewRabaluxProduct({
        productId: String(formData.get("productId") ?? ""),
        actorId,
        decision,
        reason: String(formData.get("reason") ?? ""),
      });
      revalidatePath("/admin/xml-import");
      revalidatePath("/admin/proizvodi");
      return {
        ok: true as const,
        entityId: result.productId,
        diff: result,
        message: `Proizvod je označen kao ${result.status}.`,
      };
    },
  )(formData);
}

async function reviewRabaluxPriceAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "rabalux.price.review", entity: "SupplierSyncChange" },
    async (actorId, formData: FormData) => {
      const decision = String(formData.get("decision") ?? "");
      if (decision !== "APPROVE" && decision !== "REJECT") {
        return { ok: false as const, error: "Nepoznata odluka." };
      }
      const result = await reviewRabaluxPriceProposal({
        changeId: String(formData.get("changeId") ?? ""),
        actorId,
        decision,
        reason: String(formData.get("reason") ?? ""),
      });
      revalidatePath("/admin/xml-import");
      revalidatePath("/admin/proizvodi");
      return {
        ok: true as const,
        entityId: result.changeId,
        diff: result,
        message: `Predlog cene je ${result.status}.`,
      };
    },
  )(formData);
}

async function rollbackRabaluxAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "rabalux.sync.rollback", entity: "ImportRun" },
    async (actorId, formData: FormData) => {
      const importRunId = String(formData.get("importRunId") ?? "");
      const phrase = String(formData.get("phrase") ?? "").trim();
      if (phrase !== `ROLLBACK ${importRunId}`) {
        return { ok: false as const, error: `Unesite tačnu potvrdu: ROLLBACK ${importRunId}` };
      }
      const result = await rollbackRabaluxRun({
        importRunId,
        actorId,
        reason: String(formData.get("reason") ?? ""),
      });
      revalidatePath("/admin/xml-import");
      revalidatePath("/admin/proizvodi");
      return {
        ok: true as const,
        entityId: result.runId,
        diff: result,
        message: `Rollback: ${result.applied} vraćeno, ${result.conflicts} konflikata, ${result.failed} grešaka.`,
      };
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

function jsonField(value: Prisma.JsonValue | null, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
  const field = (value as Record<string, Prisma.JsonValue>)[key];
  return typeof field === "number" || typeof field === "string" ? String(field) : "—";
}

function DashboardStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-ink-500">{label}</div>
      <div className="font-mono text-lg font-semibold">{value}</div>
    </div>
  );
}

export default async function XmlImportPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const sp = await searchParams;
  const [suppliers, edit, recentRuns] = await Promise.all([
    db.supplier.findMany({
      orderBy: { name: "asc" },
      include: { loadingLocations: { orderBy: { position: "asc" } } },
    }),
    sp.supplier
      ? db.supplier.findUnique({ where: { id: sp.supplier } })
      : Promise.resolve(null),
    db.importRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { supplier: { select: { name: true } } },
    }),
  ]);
  const rabalux = suppliers.find((supplier) => supplier.integrationKey === "RABALUX");
  const [
    pendingProducts,
    mappingConflicts,
    priceProposals,
    rollbackCandidates,
    categoryOptions,
    rabaluxQueue,
    staleRabaluxRunRows,
  ] = rabalux
    ? await Promise.all([
        db.product.findMany({
          where: {
            supplierId: rabalux.id,
            supplierApprovalStatus: { in: ["PENDING_MAPPING", "PENDING_APPROVAL"] },
            deletedAt: null,
          },
          orderBy: { updatedAt: "asc" },
          take: 50,
          select: {
            id: true,
            sku: true,
            name: true,
            supplierExternalId: true,
            supplierApprovalStatus: true,
          },
        }),
        db.supplierSyncChange.findMany({
          where: {
            supplierId: rabalux.id,
            changeType: "MAPPING_REQUIRED",
            status: "CONFLICT",
          },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: { id: true, after: true },
        }),
        db.supplierSyncChange.findMany({
          where: {
            supplierId: rabalux.id,
            changeType: "PRICE_PROPOSAL",
            status: "PENDING",
          },
          orderBy: { createdAt: "asc" },
          take: 50,
          select: {
            id: true,
            externalSku: true,
            before: true,
            after: true,
            product: { select: { name: true } },
          },
        }),
        db.importRun.findMany({
          where: {
            supplierId: rabalux.id,
            dryRun: false,
            status: { in: ["SUCCESS", "PARTIAL"] },
            rollbackOfId: null,
            changes: { some: { status: "APPLIED", reversible: true } },
          },
          orderBy: { startedAt: "desc" },
          take: 10,
          select: {
            id: true,
            kind: true,
            startedAt: true,
            recordsOk: true,
            _count: { select: { changes: true } },
          },
        }),
        db.category.findMany({
          orderBy: [{ level: "asc" }, { name: "asc" }],
          select: { id: true, name: true, path: true },
        }),
        db.backgroundJob.groupBy({
          by: ["status"],
          where: { kind: "RABALUX_MEDIA_PRODUCT" },
          _count: { _all: true },
        }),
        db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
          SELECT COUNT(*)::int AS "count"
            FROM "ImportRun"
           WHERE "supplierId" = ${rabalux.id}
             AND "status" = 'RUNNING'
             AND COALESCE("heartbeatAt", "startedAt") < NOW() - INTERVAL '10 minutes'
        `),
      ])
    : [[], [], [], [], [], [], [{ count: 0 }]];
  const staleRabaluxRuns = staleRabaluxRunRows[0]?.count ?? 0;
  const unmappedPairs = Array.from(
    new Map(
      mappingConflicts.flatMap((conflict) => {
        if (!conflict.after || typeof conflict.after !== "object" || Array.isArray(conflict.after)) {
          return [];
        }
        const after = conflict.after as Record<string, Prisma.JsonValue>;
        const category = typeof after.category === "string" ? after.category : "";
        const type = typeof after.type === "string" ? after.type : "";
        return category && type ? [[`${category}\u0000${type}`, { category, type }]] : [];
      }),
    ).values(),
  );

  return (
    <>
      <PageHeader
        title="XML import"
        description={`${suppliers.length} dobavljača · ${recentRuns.length} skorih run-ova`}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "XML feed" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {rabalux ? (
            <Card>
              <CardTitle description="Katalog dnevno · lager na 15 minuta · mediji resumable">
                Rabalux
              </CardTitle>
              <RabaluxControls
                previewAction={previewRabalux}
                executeAction={executeRabalux}
              />
              <div className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
                <DashboardStat label="Čeka odobrenje" value={pendingProducts.length} />
                <DashboardStat label="Nemapirano" value={unmappedPairs.length} />
                <DashboardStat label="Predlozi cena" value={priceProposals.length} />
                <DashboardStat label="Stale run-ovi" value={staleRabaluxRuns} />
              </div>
              <p className="mt-2 text-xs text-ink-500">
                Media queue: {rabaluxQueue.map((row) => `${row.status} ${row._count._all}`).join(" · ") || "prazan"}
              </p>

              {unmappedPairs.length ? (
                <div className="mt-5 space-y-3 border-t border-border pt-4">
                  <p className="text-sm font-medium text-ink">Mapiranje dobavljačkih kategorija</p>
                  {unmappedPairs.slice(0, 20).map((pair) => (
                    <AdminActionForm
                      key={`${pair.category}-${pair.type}`}
                      action={saveRabaluxMapping}
                      className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end"
                    >
                      <input type="hidden" name="externalCategory" value={pair.category} />
                      <input type="hidden" name="externalType" value={pair.type} />
                      <div className="text-xs"><span className="text-ink-500">Kategorija</span><br />{pair.category}</div>
                      <div className="text-xs"><span className="text-ink-500">Tip</span><br />{pair.type}</div>
                      <Field label="Interna kategorija">
                        <select
                          name="categoryId"
                          required
                          className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
                        >
                          <option value="">Izaberite…</option>
                          {categoryOptions.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.path} · {category.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <SubmitButton size="sm">Mapiraj</SubmitButton>
                    </AdminActionForm>
                  ))}
                </div>
              ) : null}

              {pendingProducts.length ? (
                <div className="mt-5 space-y-3 border-t border-border pt-4">
                  <p className="text-sm font-medium text-ink">Odobrenje proizvoda</p>
                  {pendingProducts.map((product) => (
                    <AdminActionForm
                      key={product.id}
                      action={reviewRabaluxProductAction}
                      className="space-y-2 rounded-lg border border-border p-3"
                    >
                      <input type="hidden" name="productId" value={product.id} />
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <a href={`/admin/proizvodi/${product.id}`} className="font-medium text-walnut hover:underline">
                          {product.name}
                        </a>
                        <span className="font-mono text-xs text-ink-500">
                          {product.supplierExternalId} · {product.supplierApprovalStatus}
                        </span>
                      </div>
                      <Textarea name="reason" rows={2} minLength={5} maxLength={500} required placeholder="Razlog odluke" />
                      <div className="flex gap-2">
                        <SubmitButton name="decision" value="APPROVE" size="sm">Odobri</SubmitButton>
                        <SubmitButton name="decision" value="REJECT" size="sm" variant="destructive">Odbij</SubmitButton>
                      </div>
                    </AdminActionForm>
                  ))}
                </div>
              ) : null}

              {priceProposals.length ? (
                <div className="mt-5 space-y-3 border-t border-border pt-4">
                  <p className="text-sm font-medium text-ink">Predlozi većih promena cena</p>
                  {priceProposals.map((proposal) => (
                    <AdminActionForm
                      key={proposal.id}
                      action={reviewRabaluxPriceAction}
                      className="space-y-2 rounded-lg border border-border p-3"
                    >
                      <input type="hidden" name="changeId" value={proposal.id} />
                      <p className="text-sm">
                        {proposal.product?.name ?? proposal.externalSku}: {jsonField(proposal.before, "fullPrice")} → {jsonField(proposal.after, "fullPrice")} RSD
                      </p>
                      <Textarea name="reason" rows={2} minLength={5} maxLength={500} required placeholder="Razlog odluke" />
                      <div className="flex gap-2">
                        <SubmitButton name="decision" value="APPROVE" size="sm">Odobri cenu</SubmitButton>
                        <SubmitButton name="decision" value="REJECT" size="sm" variant="destructive">Odbij</SubmitButton>
                      </div>
                    </AdminActionForm>
                  ))}
                </div>
              ) : null}

              {rollbackCandidates.length ? (
                <div className="mt-5 space-y-3 border-t border-border pt-4">
                  <p className="text-sm font-medium text-ink">Rollback primenjenih batch-eva</p>
                  {rollbackCandidates.map((run) => (
                    <AdminActionForm
                      key={run.id}
                      action={rollbackRabaluxAction}
                      className="space-y-2 rounded-lg border border-border p-3"
                    >
                      <input type="hidden" name="importRunId" value={run.id} />
                      <p className="font-mono text-xs">
                        {run.kind} · {run.id} · {run.startedAt.toLocaleString("sr-RS")} · {run._count.changes} promena
                      </p>
                      <Textarea name="reason" rows={2} minLength={5} maxLength={500} required placeholder="Razlog rollback-a" />
                      <Field label={`Upišite: ROLLBACK ${run.id}`}>
                        <Input name="phrase" autoComplete="off" required />
                      </Field>
                      <SubmitButton size="sm" variant="destructive" confirm="Rollback će pokušati da vrati samo neizmenjena polja ovog batch-a. Nastaviti?">
                        Pokreni rollback
                      </SubmitButton>
                    </AdminActionForm>
                  ))}
                </div>
              ) : null}
              <form
                action={saveRabaluxLoadingLocations}
                className="mt-5 space-y-3 border-t border-border pt-4"
              >
                <input type="hidden" name="supplierId" value={rabalux.id} />
                <p className="text-sm font-medium text-ink">Mesta preuzimanja</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {rabalux.loadingLocations.map((location) => (
                    <div key={location.id} className="space-y-2 rounded-lg border border-border p-3">
                      <p className="text-xs font-semibold text-ink-700">{location.name}</p>
                      <Field label="Adresa">
                        <Input
                          name={`address${location.position}`}
                          defaultValue={location.address ?? ""}
                          maxLength={250}
                          autoComplete="street-address"
                        />
                      </Field>
                      <Field label="Grad">
                        <Input
                          name={`city${location.position}`}
                          defaultValue={location.city ?? ""}
                          maxLength={120}
                          autoComplete="address-level2"
                        />
                      </Field>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <SubmitButton size="sm" variant="secondary">
                    Sačuvaj mesta preuzimanja
                  </SubmitButton>
                </div>
              </form>
              <p className="mt-3 text-xs text-ink-500">
                Kredencijali su server-side env promenljive i ne prikazuju se u
                administraciji.
              </p>
            </Card>
          ) : null}
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
                  actions: s.integrationKey === "RABALUX" ? (
                    <a href={`?supplier=${s.id}`} className="text-xs text-walnut hover:underline">
                      Osnovni podaci
                    </a>
                  ) : (
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
                        <SubmitButton
                          size="sm"
                          pendingLabel="Importujem…"
                          confirm="Pokrenuti stvarni XML import? Dobavljački podaci mogu promeniti katalog, cene i zalihe."
                        >
                          Pokreni import
                        </SubmitButton>
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
                  mode: r.dryRun ? "Preview" : r.kind,
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
            {edit?.integrationKey === "RABALUX" ? (
              <p className="rounded-lg bg-muted-bg p-3 text-xs text-ink-600">
                Feed adrese i autentikacija su zaključani u server konfiguraciji.
              </p>
            ) : (
              <>
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
              </>
            )}
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
            {edit?.integrationKey !== "RABALUX" ? (
              <Field label="Mapping (JSON)">
                <Textarea
                  name="mapping"
                  rows={6}
                  defaultValue={edit?.mapping ? JSON.stringify(edit.mapping, null, 2) : ""}
                  className="font-mono text-xs"
                />
              </Field>
            ) : null}
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
