import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  ReclamationDecision,
  ReclamationResolution,
  ReclamationStatus,
  ReclamationWarehouseStatus,
  ShipmentPurpose,
} from "@prisma/client";
import { requireAdminAction, withAdminState, type AdminActionState } from "@/lib/admin";
import {
  cancelReclamationShipment,
  createReclamationShipment,
  saveReclamationWarehouse,
} from "@/lib/admin/reclamation-fulfillment.server";
import { signReclamationPhotoUrls } from "@/lib/api/uploads";
import { updateReclamationStatus } from "@/lib/api/reclamation-status";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { AdminActionForm } from "@/components/admin/action-form";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { Textarea } from "@/components/ui/textarea";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Detalj reklamacije · ERP",
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<ReclamationStatus, string> = {
  PRIMLJENO: "Primljeno",
  U_OBRADI: "U obradi",
  RESENO: "Rešeno",
  ODBIJENO: "Odbijeno",
};
const DECISION_LABELS: Record<ReclamationDecision, string> = {
  CEKA: "Čeka odluku",
  PRIHVACENA: "Prihvaćena",
  ODBIJENA: "Odbijena",
};
const RESOLUTION_LABELS: Record<ReclamationResolution, string> = {
  POVRAT_NOVCA: "Povrat novca",
  ZAMENA_ARTIKLA: "Zamena artikla",
  ZAMENA_DELA: "Zamena dela",
  POPUST: "Popust",
};
const WAREHOUSE_STATUS_LABELS: Record<ReclamationWarehouseStatus, string> = {
  NOT_REQUESTED: "Nije zatraženo",
  REQUESTED: "Zatraženo",
  PREPARING: "U pripremi",
  READY: "Spremno / primljeno",
  HANDED_OVER: "Predato kuriru",
  CANCELLED: "Otkazano",
};
const PURPOSE_LABELS: Record<ShipmentPurpose, string> = {
  ORDER_DELIVERY: "Isporuka porudžbine",
  RECLAMATION_RETURN: "Preuzmi stari artikal od kupca",
  RECLAMATION_REPLACEMENT: "Isporuči zamenu/deo kupcu",
};

function refresh(id: string) {
  revalidatePath(`/admin/erp/reklamacije-dnevnik/${id}`);
  revalidatePath("/admin/erp/reklamacije-dnevnik");
  revalidatePath("/admin/erp/povrati");
  revalidatePath("/nalog/reklamacije");
}

async function saveDetailsAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "reclamation.detailsUpdate", entity: "Reclamation" },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      const decision = String(formData.get("decision") ?? "") as ReclamationDecision;
      const resolutionRaw = String(formData.get("resolution") ?? "");
      const resolution = resolutionRaw ? resolutionRaw as ReclamationResolution : null;
      if (!id || !Object.values(ReclamationDecision).includes(decision)) {
        return { ok: false as const, error: "Reklamacija ili odluka nije ispravna." };
      }
      if (resolution && !Object.values(ReclamationResolution).includes(resolution)) {
        return { ok: false as const, error: "Način rešavanja nije ispravan." };
      }
      const respondedAtRaw = String(formData.get("respondedAt") ?? "");
      const respondedAt = respondedAtRaw ? new Date(`${respondedAtRaw}T12:00:00Z`) : null;
      if (respondedAt && Number.isNaN(respondedAt.getTime())) {
        return { ok: false as const, error: "Datum odgovora nije ispravan." };
      }
      const adminNote = String(formData.get("adminNote") ?? "").trim() || null;
      const resolutionNote = String(formData.get("resolutionNote") ?? "").trim() || null;
      await db.reclamation.update({
        where: { id },
        data: { decision, resolution, respondedAt, adminNote, resolutionNote },
      });
      refresh(id);
      return { ok: true as const, entityId: id, message: "Odluka i način rešavanja su sačuvani." };
    },
  )(formData);
}

async function saveWarehouseAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "reclamation.warehouseUpdate", entity: "Reclamation" },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      const warehouseId = String(formData.get("warehouseId") ?? "");
      const status = String(formData.get("warehouseStatus") ?? "") as ReclamationWarehouseStatus;
      if (!id || !warehouseId || !Object.values(ReclamationWarehouseStatus).includes(status)) {
        return { ok: false as const, error: "Izaberite magacin i status pripreme." };
      }
      await saveReclamationWarehouse({ reclamationId: id, warehouseId, status });
      refresh(id);
      return { ok: true as const, entityId: id, message: "Magacinski zadatak je sačuvan." };
    },
  )(formData);
}

async function createShipmentAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "reclamation.shipmentCreate", entity: "Reclamation" },
    async (actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      const purpose = String(formData.get("purpose") ?? "") as ShipmentPurpose;
      const packageCount = Number(formData.get("packageCount") ?? 1);
      if (!id || !["RECLAMATION_RETURN", "RECLAMATION_REPLACEMENT"].includes(purpose) || !Number.isInteger(packageCount) || packageCount < 1 || packageCount > 99) {
        return { ok: false as const, error: "Kurirski zahtev nije ispravan." };
      }
      const shipment = await createReclamationShipment({ reclamationId: id, purpose, packageCount, actorId });
      refresh(id);
      return {
        ok: true as const,
        entityId: id,
        message: `${PURPOSE_LABELS[purpose]} — kurirski nalog je kreiran.`,
        diff: { shipmentId: shipment.id, purpose, packageCount },
      };
    },
  )(formData);
}

async function cancelShipmentAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "reclamation.shipmentCancel", entity: "Shipment" },
    async (actorId, formData: FormData) => {
      const shipmentId = String(formData.get("shipmentId") ?? "");
      const reclamationId = String(formData.get("reclamationId") ?? "");
      if (!shipmentId || !reclamationId) return { ok: false as const, error: "Pošiljka nije izabrana." };
      await cancelReclamationShipment(shipmentId, actorId);
      refresh(reclamationId);
      return { ok: true as const, entityId: shipmentId, message: "Kurirski nalog je otkazan." };
    },
  )(formData);
}

async function saveStatusAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "reclamation.statusUpdate", entity: "Reclamation" },
    async (actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      const status = String(formData.get("status") ?? "") as ReclamationStatus;
      const note = String(formData.get("note") ?? "").trim() || null;
      if (!id || !Object.values(ReclamationStatus).includes(status)) {
        return { ok: false as const, error: "Status nije ispravan." };
      }
      await updateReclamationStatus({ reclamationId: id, status, note, actorId });
      refresh(id);
      return { ok: true as const, entityId: id, message: `Status je promenjen u „${STATUS_LABELS[status]}”.` };
    },
  )(formData);
}

export default async function ReclamationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminAction(["OPS"]);
  const { id } = await params;
  const [reclamation, warehouses] = await Promise.all([
    db.reclamation.findUnique({
      where: { id },
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
          include: { events: { orderBy: { occurredAt: "desc" }, take: 10 } },
        },
      },
    }),
    db.warehouse.findMany({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
  ]);
  if (!reclamation) notFound();
  const signedPhotos = await signReclamationPhotoUrls(reclamation.photos.map((photo) => photo.url));

  return (
    <>
      <PageHeader
        title={`Reklamacija ${reclamation.number}`}
        description={`${STATUS_LABELS[reclamation.status]} · ${reclamation.customerFirst} ${reclamation.customerLast} · ${reclamation.sku}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { href: "/admin/erp/reklamacije-dnevnik", label: "Reklamacije" },
          { label: reclamation.number },
        ]}
        actions={<div className="flex gap-2"><Link href="/admin/erp/povrati" className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">Povrati</Link><Link href={`/admin/erp/prodajni-nalozi/${reclamation.orderId}`} className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">Porudžbina</Link></div>}
      />
      <main className="space-y-6 px-4 py-6 md:px-8">
        <Card>
          <CardTitle description={`Porudžbina ${reclamation.order.number} · kupljeno ${reclamation.orderItem?.qty ?? "—"} kom · reklamirano ${reclamation.quantity} kom`}>
            Prijava kupca
          </CardTitle>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <Info label="Artikal" value={`${reclamation.sku} · ${reclamation.orderItem?.name ?? reclamation.product?.name ?? "Nepoznat artikal"}`} />
            <Info label="Kontakt" value={`${reclamation.customerEmail ?? "bez email-a"} · ${reclamation.customerPhone ?? "bez telefona"}`} />
            <Info label="Primljeno" value={formatDate(reclamation.createdAt)} />
            <Info label="Zahtev kupca" value={reclamation.request ?? "Nije unet"} />
          </dl>
          <p className="mt-4 rounded-lg bg-muted-bg p-4 text-sm text-ink-800">{reclamation.description}</p>
          {reclamation.photos.length ? <div className="mt-4 flex flex-wrap gap-3">{reclamation.photos.map((photo) => <a key={photo.id} href={signedPhotos.get(photo.url) ?? photo.url} target="_blank" rel="noreferrer" className="relative block size-28 overflow-hidden rounded-lg border border-border"><Image src={signedPhotos.get(photo.url) ?? photo.url} alt="Fotografija uz reklamaciju" fill sizes="112px" className="object-cover" /></a>)}</div> : null}
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardTitle description="Odluka, datum odgovora i način rešavanja ostaju u pravnom dnevniku.">Odluka i rešenje</CardTitle>
            <AdminActionForm action={saveDetailsAction} preserveValues className="space-y-4">
              <input type="hidden" name="id" value={reclamation.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Odluka"><select name="decision" defaultValue={reclamation.decision} className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm">{Object.values(ReclamationDecision).map((value) => <option key={value} value={value}>{DECISION_LABELS[value]}</option>)}</select></Field>
                <Field label="Način rešavanja"><select name="resolution" defaultValue={reclamation.resolution ?? ""} className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"><option value="">Nije određeno</option>{Object.values(ReclamationResolution).map((value) => <option key={value} value={value}>{RESOLUTION_LABELS[value]}</option>)}</select></Field>
                <Field label="Datum odgovora"><input name="respondedAt" type="date" defaultValue={dateOnly(reclamation.respondedAt)} className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm" /></Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2"><Field label="Interna napomena"><Textarea name="adminNote" defaultValue={reclamation.adminNote ?? ""} rows={4} /></Field><Field label="Napomena o rešenju"><Textarea name="resolutionNote" defaultValue={reclamation.resolutionNote ?? ""} rows={4} /></Field></div>
              <SubmitButton pendingLabel="Čuvam…">Sačuvaj odluku</SubmitButton>
            </AdminActionForm>
          </Card>

          <Card>
            <CardTitle description="Za zamenu iz magacina status mora biti „Spremno“. Povrat kupčevog artikla i isporuka zamene su dva odvojena kurirska naloga.">Magacin i priprema</CardTitle>
            <AdminActionForm action={saveWarehouseAction} preserveValues className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={reclamation.id} />
              <Field label="Magacin"><select name="warehouseId" required defaultValue={reclamation.warehouseId ?? ""} className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"><option value="" disabled>Izaberite</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></Field>
              <Field label="Status pripreme"><select name="warehouseStatus" defaultValue={reclamation.warehouseStatus} className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm">{Object.values(ReclamationWarehouseStatus).map((value) => <option key={value} value={value}>{WAREHOUSE_STATUS_LABELS[value]}</option>)}</select></Field>
              <div className="sm:col-span-2"><SubmitButton variant="outline" pendingLabel="Čuvam…">Sačuvaj magacinski zadatak</SubmitButton></div>
            </AdminActionForm>
          </Card>
        </div>

        <Card>
          <CardTitle description="Kod zamene kreirajte oba naloga: povrat starog artikla i isporuku novog. Kod običnog povrata kreira se samo preuzimanje od kupca.">Kurirski tok</CardTitle>
          <div className="grid gap-4 lg:grid-cols-2">
            {(["RECLAMATION_RETURN", "RECLAMATION_REPLACEMENT"] as const).map((purpose) => {
              const shipment = reclamation.shipments.find((row) => row.purpose === purpose);
              return <div key={purpose} className="rounded-lg border border-border p-4"><h3 className="font-semibold">{PURPOSE_LABELS[purpose]}</h3>{shipment ? <div className="mt-2 text-sm"><p>{shipment.provider ?? "Kurir"} · <strong>{shipment.status}</strong>{shipment.trackingNo ? ` · ${shipment.trackingNo}` : ""}</p>{shipment.syncError ? <p className="mt-2 text-destructive">{shipment.syncError}</p> : null}<div className="mt-3 flex flex-wrap gap-2"><a href={`/api/admin/shipments/${shipment.id}/label`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium">Otvori / ponovo štampaj adresnicu</a>{!["DELIVERED", "RETURNED"].includes(shipment.status) ? <AdminActionForm action={cancelShipmentAction}><input type="hidden" name="shipmentId" value={shipment.id} /><input type="hidden" name="reclamationId" value={reclamation.id} /><SubmitButton size="xs" variant="destructive" confirm="Otkazati ovaj kurirski nalog?">Otkaži</SubmitButton></AdminActionForm> : null}</div></div> : <AdminActionForm action={createShipmentAction} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={reclamation.id} /><input type="hidden" name="purpose" value={purpose} /><Field label="Broj paketa"><input name="packageCount" type="number" min={1} max={99} defaultValue={1} className="h-9 w-24 rounded-lg border border-input bg-transparent px-2" /></Field><SubmitButton size="sm" confirm={`Kreirati kurirski nalog: ${PURPOSE_LABELS[purpose]}?`}>Kreiraj nalog</SubmitButton></AdminActionForm>}</div>;
            })}
          </div>
        </Card>

        <Card>
          <CardTitle description="Promena je vidljiva kupcu u Moj nalog → Reklamacije.">Status reklamacije</CardTitle>
          <AdminActionForm action={saveStatusAction} preserveValues className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-end">
            <input type="hidden" name="id" value={reclamation.id} />
            <Field label="Novi status"><select name="status" defaultValue={reclamation.status} className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm">{Object.values(ReclamationStatus).map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></Field>
            <Field label="Napomena"><Textarea name="note" rows={2} /></Field>
            <SubmitButton pendingLabel="Čuvam…">Promeni status</SubmitButton>
          </AdminActionForm>
          <ol className="mt-5 space-y-2 border-t border-border pt-4 text-sm">{reclamation.events.map((event) => <li key={event.id}><span className="font-medium">{STATUS_LABELS[event.status]}</span> · {formatDate(event.createdAt)}{event.note ? ` — ${event.note}` : ""}</li>)}</ol>
        </Card>
      </main>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted-bg/60 p-3"><dt className="text-xs text-ink-500">{label}</dt><dd className="mt-1 font-medium text-ink-900">{value}</dd></div>;
}
function formatDate(value: Date) {
  return value.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade", dateStyle: "short", timeStyle: "short" });
}
function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? "";
}
