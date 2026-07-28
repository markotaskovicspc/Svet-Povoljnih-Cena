import Image from "next/image";
import Link from "next/link";
import { ReclamationStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import {
  buildReclamationAnalytics,
  type DeliveredProductRow,
  type DeliveredSupplierRow,
  type ReclamationAnalyticsRow,
  type ReclamationBreakdown,
} from "@/lib/admin/reclamation-analytics";
import { signReclamationPhotoUrls } from "@/lib/api/uploads";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { db } from "@/lib/db";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { Field } from "@/components/admin/field";
import { PageHeader } from "@/components/admin/page-header";
import { SubmitButton } from "@/components/admin/submit-button";
import { Textarea } from "@/components/ui/textarea";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Reklamacije",
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<ReclamationStatus, string> = {
  PRIMLJENO: "Primljeno",
  U_OBRADI: "U obradi",
  RESENO: "Rešeno",
  ODBIJENO: "Odbijeno",
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

async function updateStatus(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["OPS"], action: "reclamation.statusUpdate", entity: "Reclamation" },
    async (actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      const status = String(formData.get("status") ?? "") as ReclamationStatus;
      const note = String(formData.get("note") ?? "").trim() || null;
      if (!id || !Object.values(ReclamationStatus).includes(status)) {
        return { ok: false as const, error: "Nedostaje ID ili status." };
      }
      const resolved = status === "RESENO" || status === "ODBIJENO";
      await db.$transaction([
        db.reclamation.update({
          where: { id },
          data: { status, resolvedAt: resolved ? new Date() : null },
        }),
        db.reclamationStatusEvent.create({
          data: { reclamationId: id, status, note, actorId },
        }),
      ]);
      await enqueueBackgroundJob({
        kind: "RECLAMATION_STATUS_EMAIL",
        payload: { reclamationId: id },
        idempotencyKey: `reclamation-status-email:${id}:${status}`,
      });
      revalidatePath("/admin/reklamacije");
      return { ok: true as const, entityId: id, diff: { status, note } };
    },
  )(formData);
}

export default async function ReclamationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const sp = await searchParams;
  const status = sp.status as ReclamationStatus | undefined;
  const where =
    status && Object.values(ReclamationStatus).includes(status) ? { status } : {};

  const [items, analyticsRows, deliveredBySupplier, deliveredByProduct] =
    await Promise.all([
      db.reclamation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          photos: true,
          events: { orderBy: { createdAt: "desc" } },
          order: { select: { number: true } },
        },
      }),
      db.$queryRaw<ReclamationAnalyticsRow[]>`
        SELECT
          r.id,
          r.sku,
          r.status::text AS status,
          r.type::text AS type,
          r.resolution::text AS resolution,
          r."createdAt" AS "createdAt",
          r."resolvedAt" AS "resolvedAt",
          COALESCE(
            NULLIF(BTRIM(oi.name), ''),
            NULLIF(BTRIM(p.name), ''),
            r.sku
          ) AS "productName",
          COALESCE(
            NULLIF(BTRIM(oi."supplierName"), ''),
            NULLIF(BTRIM(s.name), ''),
            'Bez dobavljača'
          ) AS supplier
        FROM "Reclamation" r
        LEFT JOIN "OrderItem" oi ON oi.id = r."orderItemId"
        LEFT JOIN "Product" p ON p.id = COALESCE(r."productId", oi."productId")
        LEFT JOIN "Supplier" s ON s.id = p."supplierId"
      `,
      db.$queryRaw<DeliveredSupplierRow[]>`
        SELECT
          COALESCE(
            NULLIF(BTRIM(oi."supplierName"), ''),
            NULLIF(BTRIM(s.name), ''),
            'Bez dobavljača'
          ) AS supplier,
          COALESCE(SUM(oi.qty), 0)::int AS "deliveredItems"
        FROM "OrderItem" oi
        JOIN "Order" o ON o.id = oi."orderId"
        LEFT JOIN "Product" p ON p.id = oi."productId"
        LEFT JOIN "Supplier" s ON s.id = p."supplierId"
        WHERE o.status = 'ISPORUCENO'
        GROUP BY 1
      `,
      db.$queryRaw<DeliveredProductRow[]>`
        SELECT
          oi.sku,
          COALESCE(SUM(oi.qty), 0)::int AS "deliveredItems"
        FROM "OrderItem" oi
        JOIN "Order" o ON o.id = oi."orderId"
        WHERE o.status = 'ISPORUCENO'
        GROUP BY oi.sku
      `,
    ]);

  const analytics = buildReclamationAnalytics(
    analyticsRows,
    deliveredBySupplier,
    deliveredByProduct,
  );

  // Photo bucket is private — swap stored canonical URLs for signed ones.
  const signedPhotoUrls = await signReclamationPhotoUrls(
    items.flatMap((reclamation) => reclamation.photos.map((photo) => photo.url)),
  );

  return (
    <>
      <PageHeader
        title="Reklamacije"
        description="Poslovni pokazatelji i operativna obrada reklamacija"
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Reklamacije" }]}
      />
      <div className="space-y-10 px-8 py-6">
        <section aria-labelledby="reclamation-overview" className="space-y-4">
          <SectionHeading
            id="reclamation-overview"
            eyebrow="Pregled poslovanja"
            title="Ukupni pokazatelji"
            description="Podaci za sve vreme. Procenat je broj reklamacija u odnosu na broj artikala iz isporučenih porudžbina."
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Ukupno reklamacija"
              value={formatInteger(analytics.totals.total)}
              hint={`${formatInteger(analytics.totals.deliveredItems)} isporučenih artikala`}
            />
            <StatCard
              label="% reklamacija"
              value={formatPercent(analytics.totals.reclamationRate)}
              hint="Reklamacije / isporučeni artikli"
            />
            <StatCard
              label="Rešene"
              value={formatInteger(analytics.totals.resolved)}
              tone="success"
              hint="Uključuje rešene i odbijene"
            />
            <StatCard
              label="Nerešene"
              value={formatInteger(analytics.totals.unresolved)}
              tone={analytics.totals.unresolved > 0 ? "warning" : "default"}
              hint="Primljene i u obradi"
            />
            <StatCard
              label="Nerešene > 5 dana"
              value={formatInteger(analytics.totals.unresolvedOver5Days)}
              tone={analytics.totals.unresolvedOver5Days > 0 ? "warning" : "default"}
              hint="Kumulativno, još otvorene"
            />
            <StatCard
              label="Nerešene > 10 dana"
              value={formatInteger(analytics.totals.unresolvedOver10Days)}
              tone={analytics.totals.unresolvedOver10Days > 0 ? "warning" : "default"}
              hint="Kumulativno, još otvorene"
            />
            <StatCard
              label="Nerešene > 20 dana"
              value={formatInteger(analytics.totals.unresolvedOver20Days)}
              tone={analytics.totals.unresolvedOver20Days > 0 ? "danger" : "default"}
              hint="Kumulativno, još otvorene"
            />
            <StatCard
              label="Nerešene > 30 dana"
              value={formatInteger(analytics.totals.unresolvedOver30Days)}
              tone={analytics.totals.unresolvedOver30Days > 0 ? "danger" : "default"}
              hint="Kumulativno, još otvorene"
            />
            <StatCard
              label="Prosečno rešavanje"
              value={formatDays(analytics.totals.averageResolutionDays)}
              hint="Od prijema do zatvaranja reklamacije"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardTitle description="Uključene su i reklamacije kojima tip još nije unet.">
                Reklamacije po tipu
              </CardTitle>
              <BreakdownTable
                rows={analytics.totals.byType}
                total={analytics.totals.total}
                labels={TYPE_LABELS}
                empty="Nema reklamacija."
              />
            </Card>
            <Card>
              <CardTitle description="Kod otvorenih reklamacija način rešavanja može biti neodređen.">
                Reklamacije po načinu rešavanja
              </CardTitle>
              <BreakdownTable
                rows={analytics.totals.byResolution}
                total={analytics.totals.total}
                labels={RESOLUTION_LABELS}
                empty="Nema reklamacija."
              />
            </Card>
          </div>
        </section>

        <section aria-labelledby="supplier-overview" className="space-y-4">
          <SectionHeading
            id="supplier-overview"
            eyebrow="Dobavljači"
            title="Isti pokazatelji po dobavljaču"
            description="Dobavljač se prvenstveno čita iz stavke porudžbine, kako istorijski podaci ne bi zavisili od kasnijih izmena kataloga."
          />
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
                supplier: (
                  <div className="min-w-40">
                    <p className="font-medium text-ink-900">{supplier.supplier}</p>
                    <p className="text-xs text-ink-500">
                      {formatInteger(supplier.deliveredItems)} isporučenih artikala
                    </p>
                  </div>
                ),
                total: formatInteger(supplier.total),
                rate: formatPercent(supplier.reclamationRate),
                types: (
                  <BreakdownCell rows={supplier.byType} labels={TYPE_LABELS} />
                ),
                resolutions: (
                  <BreakdownCell
                    rows={supplier.byResolution}
                    labels={RESOLUTION_LABELS}
                  />
                ),
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
          <SectionHeading
            id="top-products"
            eyebrow="Artikli"
            title="Top 20 artikala sa najviše reklamacija"
            description="Rangirano po broju reklamacija, uz isporučenu količinu i stopu reklamacija za svaki SKU."
          />
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
            rows={analytics.topProducts.map((product, index) => ({
              id: product.sku,
              cells: {
                rank: index + 1,
                product: <span className="font-medium text-ink-900">{product.productName}</span>,
                sku: <span className="font-mono text-xs">{product.sku}</span>,
                supplier: product.supplier,
                reclamations: formatInteger(product.reclamations),
                delivered: formatInteger(product.deliveredItems),
                rate: formatPercent(product.reclamationRate),
              },
            }))}
            empty="Nema reklamiranih artikala."
          />
        </section>

        <section aria-labelledby="reclamation-operations" className="space-y-4">
          <SectionHeading
            id="reclamation-operations"
            eyebrow="Operativa"
            title="Obrada reklamacija"
            description={`${formatInteger(items.length)} prikazanih reklamacija · klik na fotografiju otvara puni format`}
          />
          <nav aria-label="Filter statusa reklamacije" className="flex flex-wrap gap-2 text-xs">
            <FilterLink href="/admin/reklamacije" label="Sve" active={!status} />
            {Object.values(ReclamationStatus).map((reclamationStatus) => (
              <FilterLink
                key={reclamationStatus}
                href={`/admin/reklamacije?status=${reclamationStatus}`}
                label={STATUS_LABELS[reclamationStatus]}
                active={status === reclamationStatus}
              />
            ))}
          </nav>

          <div className="space-y-4">
            {items.length === 0 ? (
              <Card>
                <p className="text-sm text-ink-500">Nema reklamacija.</p>
              </Card>
            ) : (
              items.map((reclamation) => (
                <Card key={reclamation.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm">{reclamation.number}</p>
                      <p className="text-xs text-ink-500">
                        Narudžbina{" "}
                        <Link
                          href="/admin/narudzbine"
                          className="text-walnut hover:underline"
                        >
                          {reclamation.order.number}
                        </Link>{" "}
                        · SKU {reclamation.sku} · {reclamation.customerFirst}{" "}
                        {reclamation.customerLast}
                      </p>
                    </div>
                    <span className="rounded-full bg-muted-bg px-2 py-0.5 text-[11px]">
                      {STATUS_LABELS[reclamation.status]}
                    </span>
                  </div>
                  <p className="mt-3 max-w-2xl text-sm text-ink-700">
                    {reclamation.description}
                  </p>
                  {reclamation.photos.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {reclamation.photos.map((photo) => (
                        <a
                          key={photo.id}
                          href={signedPhotoUrls.get(photo.url) ?? photo.url}
                          target="_blank"
                          rel="noreferrer"
                          className="relative block size-20 overflow-hidden rounded-md border border-border/60"
                        >
                          <Image
                            src={signedPhotoUrls.get(photo.url) ?? photo.url}
                            alt=""
                            fill
                            sizes="80px"
                            className="object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  ) : null}

                  <form
                    action={updateStatus}
                    className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[200px_1fr_auto]"
                  >
                    <input type="hidden" name="id" value={reclamation.id} />
                    <Field label="Novi status">
                      <select
                        name="status"
                        defaultValue={reclamation.status}
                        className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                      >
                        {Object.values(ReclamationStatus).map((reclamationStatus) => (
                          <option key={reclamationStatus} value={reclamationStatus}>
                            {STATUS_LABELS[reclamationStatus]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Napomena (vidljiva interno)">
                      <Textarea name="note" rows={2} />
                    </Field>
                    <div className="flex items-end justify-end">
                      <SubmitButton size="sm">Sačuvaj</SubmitButton>
                    </div>
                  </form>

                  {reclamation.events.length > 0 ? (
                    <details className="mt-3 text-xs text-ink-500">
                      <summary className="cursor-pointer">
                        Istorija statusa ({reclamation.events.length})
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {reclamation.events.map((event) => (
                          <li key={event.id}>
                            {event.createdAt.toLocaleString("sr-Latn-RS")} ·{" "}
                            {STATUS_LABELS[event.status]}
                            {event.note ? ` — ${event.note}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </Card>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-walnut">
        {eyebrow}
      </p>
      <h2 id={id} className="mt-1 font-display text-2xl text-ink-900">
        {title}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-500">{description}</p>
    </div>
  );
}

function BreakdownTable({
  rows,
  total,
  labels,
  empty,
}: {
  rows: ReclamationBreakdown[];
  total: number;
  labels: Record<string, string>;
  empty: string;
}) {
  return (
    <DataTable
      columns={[
        { key: "label", label: "Kategorija" },
        { key: "count", label: "Broj", align: "right" },
        { key: "share", label: "Udeo", align: "right" },
      ]}
      rows={rows.map((row) => ({
        id: row.key,
        cells: {
          label: labels[row.key] ?? row.key,
          count: formatInteger(row.count),
          share: formatPercent(total > 0 ? (row.count / total) * 100 : 0),
        },
      }))}
      empty={empty}
    />
  );
}

function BreakdownCell({
  rows,
  labels,
}: {
  rows: ReclamationBreakdown[];
  labels: Record<string, string>;
}) {
  return (
    <div className="min-w-36 space-y-0.5 text-xs">
      {rows.map((row) => (
        <p key={row.key} className="whitespace-nowrap">
          {labels[row.key] ?? row.key}: {formatInteger(row.count)}
        </p>
      ))}
    </div>
  );
}

function FilterLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1 ${
        active
          ? "bg-walnut text-white"
          : "bg-muted-bg text-ink-700 hover:bg-muted-bg/70"
      }`}
    >
      {label}
    </Link>
  );
}

function formatInteger(value: number) {
  return value.toLocaleString("sr-Latn-RS");
}

function formatPercent(value: number) {
  return `${value.toLocaleString("sr-Latn-RS", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })}%`;
}

function formatDays(value: number | null) {
  if (value === null) return "—";
  return `${value.toLocaleString("sr-Latn-RS", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} dana`;
}
