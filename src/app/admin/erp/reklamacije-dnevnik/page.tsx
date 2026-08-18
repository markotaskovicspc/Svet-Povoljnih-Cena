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
  removeReclamationUploads,
  signReclamationPhotoUrls,
  uploadAdminReclamationPhoto,
} from "@/lib/api/uploads";
import { db } from "@/lib/db";
import { Card, CardTitle } from "@/components/admin/card";
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
  lookupOrderForReclamation,
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
      const photoFiles = actionData
        .getAll("photos")
        .filter((value): value is File => value instanceof File && value.size > 0);
      if (photoFiles.length > 5) {
        return { ok: false as const, error: "Možete dodati najviše 5 fotografija." };
      }
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

      const order = await lookupOrderForReclamation(parsed.data.orderNumberOrFiscal);
      if (!order) return { ok: false as const, error: "Porudžbina nije pronađena." };
      if (order.status !== "ISPORUCENO") {
        return {
          ok: false as const,
          error: "Ručna reklamacija je dozvoljena samo za isporučenu porudžbinu.",
        };
      }
      const orderItem = order.items.find((item) => item.sku === parsed.data.sku);
      if (!orderItem) {
        return {
          ok: false as const,
          error: "SKU mora biti stavka iz izabrane porudžbine.",
        };
      }

      const uploaded: Array<{ url: string; bytes: number }> = [];
      try {
        for (const file of photoFiles) {
          uploaded.push(
            await uploadAdminReclamationPhoto(file, {
              orderNumber: order.number,
              sku: orderItem.sku,
            }),
          );
        }
      } catch (error) {
        await removeReclamationUploads(uploaded.map((photo) => photo.url));
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : "Upload fotografije nije uspeo.",
        };
      }

      let result: Awaited<ReturnType<typeof createAdminReclamation>>;
      try {
        result = await createAdminReclamation(
          { ...parsed.data, photos: uploaded, type, request },
          actorId,
        );
      } catch (error) {
        await removeReclamationUploads(uploaded.map((photo) => photo.url));
        throw error;
      }
      if (!result.ok) {
        await removeReclamationUploads(uploaded.map((photo) => photo.url));
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
  searchParams: Promise<{ status?: string; reclamation?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const sp = await searchParams;
  const status = sp.status as ReclamationStatus | undefined;
  const where = {
    ...(status && Object.values(ReclamationStatus).includes(status) ? { status } : {}),
    ...(sp.reclamation ? { id: sp.reclamation } : {}),
  };

  const [items, warehouses, erpModule] =
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
      db.warehouse.findMany({
        where: { active: true },
        orderBy: [{ isDefault: "desc" }, { code: "asc" }],
        select: { id: true, code: true, name: true },
      }),
      getErpModule("reklamacije-dnevnik", { take: 10_000 }),
    ]);

  // Photo bucket is private — swap stored canonical URLs for signed ones.
  const signedPhotoUrls = await signReclamationPhotoUrls(
    items.flatMap((reclamation) => reclamation.photos.map((photo) => photo.url)),
  );

  return (
    <>
      <PageHeader
        title="Reklamacije"
        description="Ručni unos, dnevnik i operativna obrada reklamacija"
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Dnevnik reklamacija" },
        ]}
        actions={<div className="flex flex-wrap gap-2"><Link href="/admin/erp/reklamacije-izvestaji" className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">Reklamacije – izveštaji</Link><Link href="/api/admin/erp/reklamacije-dnevnik/export" className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">Preuzmi XLSX</Link></div>}
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
            <div className="lg:col-span-2">
              <Field label="Fotografije" hint="Do 5 JPG, PNG ili WebP fotografija, najviše 2 MB po fajlu.">
                <input
                  name="photos"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  multiple
                  className="block w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
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
                  <span id={`reclamation-${reclamation.id}`} className="scroll-mt-24" />
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

function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? "";
}
