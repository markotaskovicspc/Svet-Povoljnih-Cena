import Image from "next/image";
import Link from "next/link";
import {
  ReclamationDecision,
  ReclamationRequest,
  ReclamationResolution,
  ReclamationStatus,
  ReclamationType,
  ReclamationWarehouseStatus,
  ShipmentPurpose,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  withAdmin,
  withAdminState,
  requireAdminAction,
  type AdminActionState,
} from "@/lib/admin";
import {
  buildReclamationAnalytics,
  type DeliveredProductRow,
  type DeliveredSupplierRow,
  type ReclamationAnalyticsRow,
  type ReclamationBreakdown,
} from "@/lib/admin/reclamation-analytics";
import { signReclamationPhotoUrls } from "@/lib/api/uploads";
import { db } from "@/lib/db";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { ErpGrid } from "@/components/admin/erp-grid";
import { Field } from "@/components/admin/field";
import { PageHeader } from "@/components/admin/page-header";
import { SubmitButton } from "@/components/admin/submit-button";
import { AdminActionForm } from "@/components/admin/action-form";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelReclamationShipment,
  createReclamationShipment,
  saveReclamationWarehouse,
} from "@/lib/admin/reclamation-fulfillment.server";
import { getErpModule } from "@/lib/admin/erp";
import {
  createAdminReclamation,
  createReclamationSchema,
} from "@/lib/api/reclamations";

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

const REQUEST_LABELS: Record<ReclamationRequest, string> = {
  POPRAVKA: "Popravka",
  ZAMENA: "Zamena",
  POVRACAJ_NOVCA: "Povraćaj novca",
  UMANJENJE_CENE: "Umanjenje cene",
};

const RESOLUTION_LABELS: Record<string, string> = {
  POVRAT_NOVCA: "Povrat novca",
  ZAMENA_ARTIKLA: "Zamena artikla",
  ZAMENA_DELA: "Zamena dela",
  POPUST: "Popust",
  NIJE_UNETO: "Nije određeno",
};

const DECISION_LABELS: Record<ReclamationDecision, string> = {
  CEKA: "Čeka odluku",
  PRIHVACENA: "Prihvaćena",
  ODBIJENA: "Odbijena",
};

const WAREHOUSE_STATUS_LABELS: Record<ReclamationWarehouseStatus, string> = {
  NOT_REQUESTED: "Nije zatraženo",
  REQUESTED: "Zatraženo",
  PREPARING: "U pripremi",
  READY: "Spremno",
  HANDED_OVER: "Predato kuriru",
  CANCELLED: "Otkazano",
};

const SHIPMENT_PURPOSE_LABELS: Record<ShipmentPurpose, string> = {
  ORDER_DELIVERY: "Isporuka porudžbine",
  RECLAMATION_RETURN: "Povrat od kupca",
  RECLAMATION_REPLACEMENT: "Isporuka zamene/dela",
};

async function createManualReclamation(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    {
      allowed: ["OPS"],
      action: "reclamation.manualCreate",
      entity: "Reclamation",
    },
    async (actorId, actionData: FormData) => {
      const parsed = createReclamationSchema.safeParse({
        orderNumberOrFiscal: actionData.get("orderNumberOrFiscal"),
        sku: actionData.get("sku"),
        quantity: Number(actionData.get("quantity")),
        description: actionData.get("description"),
        photos: [],
      });
      if (!parsed.success) {
        return {
          ok: false as const,
          error:
            parsed.error.issues[0]?.message ??
            "Podaci za reklamaciju nisu ispravni.",
        };
      }

      const typeRaw = String(actionData.get("type") ?? "").trim();
      const requestRaw = String(actionData.get("request") ?? "").trim();
      const type = typeRaw ? (typeRaw as ReclamationType) : null;
      const request = requestRaw ? (requestRaw as ReclamationRequest) : null;
      if (type && !Object.values(ReclamationType).includes(type)) {
        return { ok: false as const, error: "Tip reklamacije nije ispravan." };
      }
      if (request && !Object.values(ReclamationRequest).includes(request)) {
        return { ok: false as const, error: "Zahtev kupca nije ispravan." };
      }

      const result = await createAdminReclamation(
        { ...parsed.data, type, request },
        actorId,
      );
      if (!result.ok) {
        const errors: Record<typeof result.reason, string> = {
          ORDER_NOT_FOUND: "Porudžbina nije pronađena.",
          ORDER_NOT_DELIVERED:
            "Ručna reklamacija je dozvoljena samo za isporučenu porudžbinu.",
          ITEM_NOT_FOUND: "Stavka nije pronađena u porudžbini.",
          UNAUTHORIZED: "Nemate pravo da unesete ovu reklamaciju.",
          INVALID_PHOTO: "Priložena fotografija nije ispravna.",
          QUANTITY_EXCEEDED:
            "Količina prelazi preostalu reklamabilnu količinu.",
        };
        return { ok: false as const, error: errors[result.reason] };
      }

      revalidatePath("/admin/erp/reklamacije-dnevnik");
      revalidatePath("/nalog/reklamacije");
      return {
        ok: true as const,
        entityId: result.id,
        message: `Reklamacija ${result.number} je ručno evidentirana.`,
        diff: {
          number: result.number,
          orderNumberOrFiscal: parsed.data.orderNumberOrFiscal,
          sku: parsed.data.sku,
          quantity: parsed.data.quantity,
          type,
          request,
        },
      };
    },
  )(formData);
}

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
      revalidatePath("/admin/erp/reklamacije-dnevnik");
      revalidatePath("/nalog/reklamacije");
      return { ok: true as const, entityId: id, diff: { status, note } };
    },
  )(formData);
}

async function updateReclamationDetails(formData: FormData) {
  "use server";

  return withAdmin(
    {
      allowed: ["OPS"],
      action: "reclamation.detailsUpdate",
      entity: "Reclamation",
    },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      const decision = String(formData.get("decision") ?? "") as ReclamationDecision;
      const resolutionRaw = String(formData.get("resolution") ?? "");
      const respondedAtRaw = String(formData.get("respondedAt") ?? "");
      if (!id || !Object.values(ReclamationDecision).includes(decision)) {
        return { ok: false as const, error: "Nedostaje reklamacija ili odluka." };
      }
      const resolution = resolutionRaw
        ? (resolutionRaw as ReclamationResolution)
        : null;
      if (resolution && !Object.values(ReclamationResolution).includes(resolution)) {
        return { ok: false as const, error: "Nepoznat način rešavanja." };
      }
      const respondedAt = respondedAtRaw
        ? new Date(`${respondedAtRaw}T12:00:00.000Z`)
        : null;
      if (respondedAt && Number.isNaN(respondedAt.getTime())) {
        return { ok: false as const, error: "Datum odgovora nije ispravan." };
      }
      const adminNote = String(formData.get("adminNote") ?? "").trim() || null;
      const resolutionNote =
        String(formData.get("resolutionNote") ?? "").trim() || null;
      await db.reclamation.update({
        where: { id },
        data: { decision, resolution, respondedAt, adminNote, resolutionNote },
      });
      revalidatePath("/admin/erp/reklamacije-dnevnik");
      return {
        ok: true as const,
        entityId: id,
        diff: { decision, resolution, respondedAt, adminNote, resolutionNote },
      };
    },
  )(formData);
}

async function updateWarehouse(formData: FormData) {
  "use server";

  return withAdmin(
    {
      allowed: ["OPS"],
      action: "reclamation.warehouseUpdate",
      entity: "Reclamation",
    },
    async (_actorId, formData: FormData) => {
      const reclamationId = String(formData.get("id") ?? "");
      const warehouseId = String(formData.get("warehouseId") ?? "");
      const status = String(
        formData.get("warehouseStatus") ?? "",
      ) as ReclamationWarehouseStatus;
      if (
        !reclamationId ||
        !warehouseId ||
        !Object.values(ReclamationWarehouseStatus).includes(status)
      ) {
        return { ok: false as const, error: "Izaberite magacin i status pripreme." };
      }
      await saveReclamationWarehouse({ reclamationId, warehouseId, status });
      revalidatePath("/admin/erp/reklamacije-dnevnik");
      return {
        ok: true as const,
        entityId: reclamationId,
        diff: { warehouseId, status },
      };
    },
  )(formData);
}

async function createShipment(formData: FormData) {
  "use server";

  return withAdmin(
    {
      allowed: ["OPS"],
      action: "reclamation.shipmentCreate",
      entity: "Reclamation",
    },
    async (_actorId, formData: FormData) => {
      const reclamationId = String(formData.get("id") ?? "");
      const purpose = String(formData.get("purpose") ?? "") as ShipmentPurpose;
      const packageCount = Number(formData.get("packageCount") ?? 1);
      if (
        !reclamationId ||
        !["RECLAMATION_RETURN", "RECLAMATION_REPLACEMENT"].includes(purpose) ||
        !Number.isInteger(packageCount) ||
        packageCount < 1 ||
        packageCount > 99
      ) {
        return { ok: false as const, error: "Kurirski zahtev nije ispravan." };
      }
      const shipment = await createReclamationShipment({
        reclamationId,
        purpose,
        packageCount,
      });
      revalidatePath("/admin/erp/reklamacije-dnevnik");
      return {
        ok: true as const,
        entityId: reclamationId,
        diff: { purpose, packageCount, shipmentId: shipment.id },
      };
    },
  )(formData);
}

async function cancelShipment(formData: FormData) {
  "use server";

  return withAdmin(
    {
      allowed: ["OPS"],
      action: "reclamation.shipmentCancel",
      entity: "Shipment",
    },
    async (_actorId, formData: FormData) => {
      const shipmentId = String(formData.get("shipmentId") ?? "");
      if (!shipmentId) {
        return { ok: false as const, error: "Pošiljka nije izabrana." };
      }
      const shipment = await cancelReclamationShipment(shipmentId);
      revalidatePath("/admin/erp/reklamacije-dnevnik");
      return {
        ok: true as const,
        entityId: shipment.id,
        diff: { status: shipment.status },
      };
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

  const [items, analyticsRows, deliveredBySupplier, deliveredByProduct, warehouses, erpModule] =
    await Promise.all([
      db.reclamation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          photos: true,
          events: { orderBy: { createdAt: "desc" } },
          order: { select: { number: true } },
          orderItem: { select: { name: true, qty: true } },
          product: { select: { name: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          shipments: {
            where: { purpose: { not: "ORDER_DELIVERY" } },
            orderBy: { createdAt: "desc" },
            include: { events: { orderBy: { occurredAt: "desc" }, take: 5 } },
          },
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
      db.warehouse.findMany({
        where: { active: true },
        orderBy: [{ isDefault: "desc" }, { code: "asc" }],
        select: { id: true, code: true, name: true },
      }),
      getErpModule("reklamacije-dnevnik", { take: 10_000 }),
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
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Dnevnik reklamacija" },
        ]}
        actions={
          <Link
            href="/api/admin/erp/reklamacije-dnevnik/export"
            className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
          >
            Preuzmi XLSX
          </Link>
        }
      />
      <div className="space-y-10 px-8 py-6">
        <Card>
          <CardTitle description="Za telefonsku, prodajnu ili drugu prijavu koju operater evidentira u ime kupca. Dostupne su samo isporučene porudžbine i preostale količine.">
            Ručni unos reklamacije
          </CardTitle>
          <AdminActionForm
            action={createManualReclamation}
            refreshOnSuccess
            className="mt-4 grid gap-4 lg:grid-cols-2"
            testId="manual-reclamation-form"
          >
            <Field label="Broj porudžbine ili fiskalnog računa">
              <input
                name="orderNumberOrFiscal"
                required
                autoComplete="off"
                placeholder="npr. SPC-2026-000123"
                className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
              />
            </Field>
            <Field label="SKU artikla">
              <input
                name="sku"
                required
                autoComplete="off"
                placeholder="Šifra artikla sa porudžbine"
                className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
              />
            </Field>
            <Field label="Količina">
              <input
                name="quantity"
                type="number"
                min={1}
                max={999}
                defaultValue={1}
                required
                className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
              />
            </Field>
            <Field label="Tip reklamacije">
              <select
                name="type"
                defaultValue=""
                className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Nije uneto</option>
                {Object.values(ReclamationType).map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type] ?? type}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Zahtev kupca">
              <select
                name="request"
                defaultValue=""
                className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Nije uneto</option>
                {Object.values(ReclamationRequest).map((request) => (
                  <option key={request} value={request}>
                    {REQUEST_LABELS[request]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="lg:col-span-2">
              <Field label="Opis prijave">
                <Textarea
                  name="description"
                  minLength={5}
                  maxLength={250}
                  rows={3}
                  required
                  placeholder="Unesite opis problema tačno kako ga je kupac prijavio."
                />
              </Field>
            </div>
            <div className="flex justify-end lg:col-span-2">
              <SubmitButton pendingLabel="Evidentiram…">
                Evidentiraj reklamaciju
              </SubmitButton>
            </div>
          </AdminActionForm>
        </Card>
        {erpModule ? (
          <section aria-labelledby="reclamation-grid" className="space-y-3">
            <div>
              <h2 id="reclamation-grid" className="font-display text-2xl text-ink-900">
                Dnevnik za filtere i izvoz
              </h2>
              <p className="text-sm text-ink-500">
                Zajednički ERP grid sa sačuvanim pogledima, izborom kolona i XLSX izvozom.
              </p>
            </div>
            <ErpGrid module={erpModule} />
          </section>
        ) : null}
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
            <FilterLink href="/admin/erp/reklamacije-dnevnik" label="Sve" active={!status} />
            {Object.values(ReclamationStatus).map((reclamationStatus) => (
              <FilterLink
                key={reclamationStatus}
                href={`/admin/erp/reklamacije-dnevnik?status=${reclamationStatus}`}
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
                          href={`/admin/erp/prodajni-nalozi/${reclamation.orderId}`}
                          className="text-walnut hover:underline"
                        >
                          {reclamation.order.number}
                        </Link>{" "}
                        · {reclamation.orderItem?.name ?? reclamation.product?.name ?? "Nepoznat artikal"}
                        {" · "}SKU {reclamation.sku} · količina {reclamation.quantity}
                        {" · "}{reclamation.customerFirst}{" "}
                        {reclamation.customerLast}
                      </p>
                      <p className="mt-1 text-xs text-ink-500">
                        Kupac prati status kroz portal „Moj nalog → Reklamacije”.
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

                  <div className="mt-4 grid gap-4 border-t border-border/60 pt-4 xl:grid-cols-2">
                    <form action={updateReclamationDetails} className="space-y-3">
                      <input type="hidden" name="id" value={reclamation.id} />
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Odluka">
                          <select
                            name="decision"
                            defaultValue={reclamation.decision}
                            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                          >
                            {Object.values(ReclamationDecision).map((decision) => (
                              <option key={decision} value={decision}>
                                {DECISION_LABELS[decision]}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Način rešavanja">
                          <select
                            name="resolution"
                            defaultValue={reclamation.resolution ?? ""}
                            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                          >
                            <option value="">Nije određeno</option>
                            {Object.values(ReclamationResolution).map((resolution) => (
                              <option key={resolution} value={resolution}>
                                {RESOLUTION_LABELS[resolution] ?? resolution}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Datum odgovora">
                          <input
                            name="respondedAt"
                            type="date"
                            defaultValue={dateOnly(reclamation.respondedAt)}
                            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                          />
                        </Field>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Interna napomena">
                          <Textarea
                            name="adminNote"
                            defaultValue={reclamation.adminNote ?? ""}
                            rows={2}
                          />
                        </Field>
                        <Field label="Napomena o rešenju">
                          <Textarea
                            name="resolutionNote"
                            defaultValue={reclamation.resolutionNote ?? ""}
                            rows={2}
                          />
                        </Field>
                      </div>
                      <div className="flex justify-end">
                        <SubmitButton size="sm">Sačuvaj obradu</SubmitButton>
                      </div>
                    </form>

                    <div className="space-y-3">
                      <form action={updateWarehouse} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                        <input type="hidden" name="id" value={reclamation.id} />
                        <Field label="Magacin">
                          <select
                            name="warehouseId"
                            defaultValue={reclamation.warehouseId ?? ""}
                            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                            required
                          >
                            <option value="" disabled>
                              Izaberite
                            </option>
                            {warehouses.map((warehouse) => (
                              <option key={warehouse.id} value={warehouse.id}>
                                {warehouse.code} · {warehouse.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Status pripreme">
                          <select
                            name="warehouseStatus"
                            defaultValue={reclamation.warehouseStatus}
                            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                          >
                            {Object.values(ReclamationWarehouseStatus).map((warehouseStatus) => (
                              <option key={warehouseStatus} value={warehouseStatus}>
                                {WAREHOUSE_STATUS_LABELS[warehouseStatus]}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div className="flex items-end justify-end">
                          <SubmitButton size="sm" variant="outline">
                            Sačuvaj magacin
                          </SubmitButton>
                        </div>
                      </form>

                      <div className="rounded-lg border border-border/60 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                          Povrat i zamena
                        </p>
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          {(["RECLAMATION_RETURN", "RECLAMATION_REPLACEMENT"] as const).map(
                            (purpose) => {
                              const existing = reclamation.shipments.find(
                                (shipment) => shipment.purpose === purpose,
                              );
                              return existing ? (
                                <div
                                  key={purpose}
                                  className="min-w-56 rounded-md bg-muted-bg px-3 py-2 text-xs"
                                >
                                  <p className="font-medium text-ink-900">
                                    {SHIPMENT_PURPOSE_LABELS[purpose]}
                                  </p>
                                  <p className="mt-0.5 text-ink-600">
                                    {existing.provider ?? "Kurir"} · {existing.status}
                                    {existing.trackingNo ? ` · ${existing.trackingNo}` : ""}
                                  </p>
                                  {existing.status !== "DELIVERED" &&
                                  existing.status !== "RETURNED" ? (
                                    <form action={cancelShipment} className="mt-2">
                                      <input
                                        type="hidden"
                                        name="shipmentId"
                                        value={existing.id}
                                      />
                                      <SubmitButton
                                        size="xs"
                                        variant="destructive"
                                        confirm="Otkazati ovaj kurirski nalog? Akcija se šalje podržanom provajderu."
                                      >
                                        Otkaži
                                      </SubmitButton>
                                    </form>
                                  ) : null}
                                </div>
                              ) : (
                                <form
                                  key={purpose}
                                  action={createShipment}
                                  className="flex items-end gap-2"
                                >
                                  <input type="hidden" name="id" value={reclamation.id} />
                                  <input type="hidden" name="purpose" value={purpose} />
                                  <Field label="Paketa">
                                    <input
                                      name="packageCount"
                                      type="number"
                                      min={1}
                                      max={99}
                                      defaultValue={1}
                                      className="h-8 w-20 rounded-lg border border-input bg-transparent px-2 text-sm"
                                    />
                                  </Field>
                                  <SubmitButton
                                    size="sm"
                                    confirm={`Kreirati kurirski nalog: ${SHIPMENT_PURPOSE_LABELS[purpose]}?`}
                                  >
                                    {purpose === "RECLAMATION_RETURN"
                                      ? "Kreiraj povrat"
                                      : "Pošalji zamenu"}
                                  </SubmitButton>
                                </form>
                              );
                            },
                          )}
                        </div>
                        <p className="mt-2 text-xs text-ink-500">
                          Samo potvrđena isporuka zamene/dela automatski zatvara reklamaciju.
                        </p>
                      </div>
                    </div>
                  </div>

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

function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? "";
}
