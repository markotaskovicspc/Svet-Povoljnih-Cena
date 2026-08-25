import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AdminActionForm } from "@/components/admin/action-form";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { PageHeader } from "@/components/admin/page-header";
import { PendingLinkLabel } from "@/components/admin/pending-link-label";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { AdminActionState } from "@/lib/admin/action-state";
import { requireAdminAction, withAdminState } from "@/lib/admin";
import {
  createPickupBatch,
  confirmMyGlsPickupAnnouncement,
  deletePickupBatches,
  getPickupPostingAvailability,
  loadEligibleOrders,
  postPickupBatches,
  removeOrderFromPickupBatch,
  savePickupPackage,
  savePickupWindow,
} from "@/lib/admin/pickup-batch.server";
import {
  formatBelgradeDateTimeLocal,
  isPickupBatchEditable,
  MYGLS_BOOKING_CHANNEL_LABEL,
  MYGLS_BOOKING_CHANNELS,
  parseBelgradeDateTimeLocal,
  PICKUP_BATCH_STATUS_LABEL,
  pickupPostingBlockReason,
} from "@/lib/admin/pickup-batch";
import {
  hasKnownMyGlsHardLimitViolation,
  hasKnownMyGlsOversizeSurcharge,
} from "@/lib/courier/packages";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Nalog za preuzimanje · ERP",
  robots: { index: false, follow: false },
};

const saveDateSchema = z.object({
  batchId: z.string().min(1),
  pickupStart: z.string().min(1, "Početak preuzimanja je obavezan."),
  pickupEnd: z.string().min(1, "Kraj preuzimanja je obavezan."),
});

const batchSchema = z.object({ batchId: z.string().min(1) });
const providerSchema = z.enum(["MYGLS", "X_EXPRESS"]);
const removeOrderSchema = batchSchema.extend({ orderId: z.string().min(1) });
const packageSchema = batchSchema.extend({
  lineId: z.string().min(1),
  weightKg: z.coerce.number().positive().max(1000),
  widthCm: z.coerce.number().positive().max(500),
  depthCm: z.coerce.number().positive().max(500),
  heightCm: z.coerce.number().positive().max(500),
});
const bookingSchema = batchSchema.extend({
  channel: z.enum(MYGLS_BOOKING_CHANNELS),
  reference: z.string().trim().min(1).max(120),
});

async function createAction(formData: FormData) {
  "use server";
  const provider = providerSchema.safeParse(formData.get("provider"));
  if (!provider.success) return;
  const state = await withAdminState(
    {
      allowed: ["OPS"],
      action: "pickup-batch.create",
      entity: "PickupBatch",
    },
    async () => {
      const batch = await createPickupBatch(provider.data);
      return {
        ok: true as const,
        entityId: batch.id,
        message: `Nalog ${batch.number} je kreiran.`,
        result: { id: batch.id },
      };
    },
  )();
  if (state.ok && isIdResult(state.result)) {
    redirect(`/admin/erp/preuzimanja/${state.result.id}?mode=edit`);
  }
}

async function saveDateAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "pickup-batch.date.save",
      entity: "PickupBatch",
    },
    async (_actorId, actionData: FormData) => {
      const parsed = saveDateSchema.safeParse(
        Object.fromEntries(actionData.entries()),
      );
      if (!parsed.success) {
        return {
          ok: false as const,
          error:
            parsed.error.issues[0]?.message ?? "Datum preuzimanja nije ispravan.",
        };
      }
      const start = parseBelgradeDateTimeLocal(parsed.data.pickupStart);
      const end = parseBelgradeDateTimeLocal(parsed.data.pickupEnd);
      await savePickupWindow(parsed.data.batchId, start, end);
      revalidatePickupPaths(parsed.data.batchId);
      return {
        ok: true as const,
        entityId: parsed.data.batchId,
        message: "Termin preuzimanja je sačuvan.",
      };
    },
  )(formData);
}

async function savePackageAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "pickup-batch.package.save",
      entity: "PickupBatchLine",
    },
    async (_actorId, actionData: FormData) => {
      const parsed = packageSchema.safeParse(Object.fromEntries(actionData.entries()));
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Mere paketa nisu ispravne.",
        };
      }
      await savePickupPackage(parsed.data.batchId, parsed.data.lineId, {
        weightKg: parsed.data.weightKg,
        widthCm: parsed.data.widthCm,
        depthCm: parsed.data.depthCm,
        heightCm: parsed.data.heightCm,
      });
      revalidatePickupPaths(parsed.data.batchId);
      return {
        ok: true as const,
        entityId: parsed.data.lineId,
        message: "Stvarne mere paketa su sačuvane.",
      };
    },
  )(formData);
}

async function confirmMyGlsBookingAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "pickup-batch.mygls-booking.confirm",
      entity: "PickupBatch",
    },
    async (actorId, actionData: FormData) => {
      const parsed = bookingSchema.safeParse(Object.fromEntries(actionData.entries()));
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Podaci GLS najave nisu ispravni.",
        };
      }
      const result = await confirmMyGlsPickupAnnouncement(
        parsed.data.batchId,
        actorId,
        { channel: parsed.data.channel, reference: parsed.data.reference },
      );
      revalidatePickupPaths(parsed.data.batchId);
      return {
        ok: true as const,
        entityId: parsed.data.batchId,
        diff: result,
        message: `Ručna MyGLS najava je evidentirana za ${result.orderCount} porudžbina.`,
      };
    },
  )(formData);
}

async function loadOrdersAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "pickup-batch.orders.load",
      entity: "PickupBatch",
    },
    async (actorId, actionData: FormData) => {
      const parsed = batchSchema.safeParse(Object.fromEntries(actionData.entries()));
      if (!parsed.success) {
        return { ok: false as const, error: "Nalog nije izabran." };
      }
      const result = await loadEligibleOrders(parsed.data.batchId, actorId);
      revalidatePickupPaths(parsed.data.batchId);
      return {
        ok: true as const,
        entityId: parsed.data.batchId,
        diff: result,
        message: pickupLoadMessage(result),
      };
    },
  )(formData);
}

async function removeOrderAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "pickup-batch.order.remove",
      entity: "PickupBatchLine",
    },
    async (actorId, actionData: FormData) => {
      const parsed = removeOrderSchema.safeParse(
        Object.fromEntries(actionData.entries()),
      );
      if (!parsed.success) {
        return { ok: false as const, error: "Porudžbina nije izabrana." };
      }
      const result = await removeOrderFromPickupBatch(
        parsed.data.batchId,
        parsed.data.orderId,
        actorId,
      );
      revalidatePickupPaths(parsed.data.batchId);
      return {
        ok: true as const,
        entityId: parsed.data.batchId,
        diff: result,
        message: `Porudžbina je uklonjena; obrisano redova: ${result.removedLineCount}. Status je vraćen u Kreirano.`,
      };
    },
  )(formData);
}

async function deleteAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";
  const state = await withAdminState(
    {
      allowed: ["OPS"],
      action: "pickup-batch.delete",
      entity: "PickupBatch",
    },
    async (actorId, actionData: FormData) => {
      const parsed = batchSchema.safeParse(Object.fromEntries(actionData.entries()));
      if (!parsed.success) {
        return { ok: false as const, error: "Nalog nije izabran." };
      }
      await deletePickupBatches([parsed.data.batchId], actorId);
      revalidatePath("/admin/erp/preuzimanja");
      return {
        ok: true as const,
        entityId: parsed.data.batchId,
        message: "Nalog je obrisan.",
      };
    },
  )(formData);
  if (state.ok) redirect("/admin/erp/preuzimanja");
  return state;
}

async function postAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "pickup-batch.post",
      entity: "PickupBatch",
    },
    async (actorId, actionData: FormData) => {
      const parsed = batchSchema.safeParse(Object.fromEntries(actionData.entries()));
      if (!parsed.success) {
        return { ok: false as const, error: "Nalog nije izabran." };
      }
      const batch = await db.pickupBatch.findUnique({
        where: { id: parsed.data.batchId },
        select: { provider: true },
      });
      const availability = await getPickupPostingAvailability(batch?.provider);
      const result = await postPickupBatches([parsed.data.batchId], actorId);
      revalidatePickupPaths(parsed.data.batchId);
      return {
        ok: true as const,
        entityId: parsed.data.batchId,
        diff: result,
        message:
          availability.provider === "MYGLS"
            ? `MyGLS adresnice su kreirane za ${result.shipmentCount} porudžbina. Prikup još nije najavljen.`
            : `Nalog je proknjižen; X Express pošiljki: ${result.shipmentCount}.`,
      };
    },
  )(formData);
}

export default async function PickupBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const batch = await db.pickupBatch.findUnique({
    where: { id },
    include: {
      lines: {
        include: {
          order: { select: { id: true, number: true, status: true } },
          orderItem: {
            include: {
              product: {
                select: {
                  barcode: true,
                  shortDescription: true,
                  shortName: true,
                  name: true,
                  attribute1: true,
                  attribute2: true,
                  attribute3: true,
                  attribute4: true,
                  colorPrimary: true,
                  colorSecondary: true,
                  collection: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!batch) notFound();

  const posting = await getPickupPostingAvailability(batch.provider);
  const myGls = posting.provider === "MYGLS";
  const editable =
    isPickupBatchEditable(batch.status) && !batch.labelsCreationStartedAt;
  const canPost =
    isPickupBatchEditable(batch.status) &&
    (myGls ? !batch.labelsCreatedAt : editable);
  const editing = query.mode === "edit" && editable;
  const rows = batch.lines
    .map((line) => pickupLineRow(line))
    .sort(
      (left, right) =>
        left.sku.localeCompare(right.sku, "sr-Latn", {
          numeric: true,
          sensitivity: "base",
        }) ||
        left.orderNumber.localeCompare(right.orderNumber, "sr-Latn", {
          numeric: true,
        }),
    );
  const completePackageCount = rows.filter((row) => row.measurementsComplete).length;
  const invalidPackageCount = myGls
    ? rows.filter((row) => hasKnownMyGlsHardLimitViolation(row)).length
    : 0;
  const postingBlockReason = pickupPostingBlockReason({
    configurationIssue: batch.labelsCreationStartedAt
      ? batch.configurationIssue
      : null,
    providerReason: posting.reason,
    provider: posting.provider,
    rowCount: rows.length,
    pickupStartSet: Boolean(batch.pickupDate),
    pickupEndSet: Boolean(batch.pickupWindowEnd),
    completePackageCount,
    invalidPackageCount,
  });
  const postingReasonId = "pickup-posting-block-reason";

  return (
    <>
      <PageHeader
        title={`Nalog za preuzimanje ${batch.number}`}
        description={`${PICKUP_BATCH_STATUS_LABEL[batch.status]} · ${rows.length} redova`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { href: "/admin/erp/preuzimanja", label: "Nalozi za preuzimanje" },
          { label: batch.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/admin/erp/preuzimanja/${batch.id}/stampa?section=picking`}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
            >
              Samostalna picking lista
            </Link>
            <Link
              href={`/admin/erp/preuzimanja/${batch.id}/stampa?section=labels`}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
            >
              Etikete i kurirske adresnice
            </Link>
            <form action={createAction}>
              <input type="hidden" name="provider" value="X_EXPRESS" />
              <SubmitButton variant="outline" pendingLabel="Kreiranje…">
                Novi X Express
              </SubmitButton>
            </form>
            <form action={createAction}>
              <input type="hidden" name="provider" value="MYGLS" />
              <SubmitButton variant="outline" pendingLabel="Kreiranje…">
                Novi MyGLS
              </SubmitButton>
            </form>
            {editable ? (
              editing ? (
                <Link
                  href={`/admin/erp/preuzimanja/${batch.id}`}
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
                >
                  <PendingLinkLabel
                    idle="Završi uređivanje"
                    pending="Završavanje…"
                  />
                </Link>
              ) : (
                <Link
                  href={`/admin/erp/preuzimanja/${batch.id}?mode=edit`}
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
                >
                  <PendingLinkLabel idle="Uredi" pending="Otvaranje…" />
                </Link>
              )
            ) : (
              <Button type="button" variant="outline" disabled>
                Uredi
              </Button>
            )}
            <AdminActionForm action={deleteAction}>
              <input type="hidden" name="batchId" value={batch.id} />
              <SubmitButton
                variant="destructive"
                disabled={!editable}
                pendingLabel="Brisanje…"
                confirm="Obrisati nalog? Sve njegove porudžbine biće vraćene u status Kreirano."
              >
                Obriši
              </SubmitButton>
            </AdminActionForm>
            <AdminActionForm action={postAction}>
              <input type="hidden" name="batchId" value={batch.id} />
              <SubmitButton
                variant="outline"
                disabled={
                  !canPost ||
                  !rows.length ||
                  !batch.pickupDate ||
                  !batch.pickupWindowEnd ||
                  !posting.available ||
                  completePackageCount !== rows.length ||
                  invalidPackageCount > 0
                }
                pendingLabel={myGls ? "Kreiranje adresnica…" : "Knjiženje…"}
                confirm={
                  myGls
                    ? "Kreirati MyGLS adresnice za sve pakete? Ovo NE najavljuje dolazak kurira; najava se posle evidentira zasebno."
                    : "Proknjižiti nalog i poslati po jednu najavu za svaku porudžbinu X Express-u? Pošiljke moraju biti spakovane, označene i spremne za preuzimanje."
                }
                title={postingBlockReason ?? undefined}
                aria-describedby={postingBlockReason ? postingReasonId : undefined}
              >
                {myGls ? "Kreiraj adresnice" : "Proknjiži"}
              </SubmitButton>
            </AdminActionForm>
          </div>
        }
      />

      <div className="space-y-6 px-4 py-6 md:px-8">
        <Card>
          <CardTitle
            description={
              editing
                ? "Režim uređivanja je uključen. Svaka izmena se čuva svojim dugmetom; „Završi uređivanje“ samo vraća pregled naloga."
                : editable
                  ? "Ovo je pregled naloga. Kliknite „Uredi“ da promenite termin, učitate porudžbine ili unesete mere paketa."
                  : "Nalog je zaključan za izmene jer više nije u statusu Novi."
            }
          >
            Podaci naloga
          </CardTitle>
          <div className="mb-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-lg bg-muted-bg/50 p-3">
              <p className="text-ink-500">Status</p>
              <p className="font-semibold">{PICKUP_BATCH_STATUS_LABEL[batch.status]}</p>
            </div>
            <div className="rounded-lg bg-muted-bg/50 p-3">
              <p className="text-ink-500">Broj naloga</p>
              <p className="font-semibold">{batch.number}</p>
            </div>
            <div className="rounded-lg bg-muted-bg/50 p-3">
              <p className="text-ink-500">Datum naloga</p>
              <p className="font-semibold">{formatDate(batch.createdAt)}</p>
            </div>
            <div className="rounded-lg bg-muted-bg/50 p-3">
              <p className="text-ink-500">Kurir</p>
              <p className="font-semibold">{posting.provider === "MYGLS" ? "MyGLS" : "X Express"}</p>
            </div>
            <div className="rounded-lg bg-muted-bg/50 p-3">
              <p className="text-ink-500">Adresnice</p>
              <p className="font-semibold">
                {batch.labelsCreatedAt
                  ? formatDateTime(batch.labelsCreatedAt)
                  : batch.labelsCreationStartedAt
                    ? `Delimično / pokušaj ${formatDateTime(batch.labelsCreationStartedAt)}`
                    : "Nisu kreirane"}
              </p>
            </div>
          </div>
          <AdminActionForm action={saveDateAction}>
            <fieldset disabled={!editing} className="grid gap-4 md:grid-cols-[minmax(0,280px)_minmax(0,280px)_auto] md:items-end">
              <input type="hidden" name="batchId" value={batch.id} />
              <Field label="Početak preuzimanja" hint={myGls ? "Za prvi prikup: najmanje 24 sata od trenutka najave." : "Najmanje 1 sat od trenutka najave."}>
                <Input
                  name="pickupStart"
                  type="datetime-local"
                  required
                  defaultValue={formatBelgradeDateTimeLocal(batch.pickupDate)}
                />
              </Field>
              <Field label="Kraj preuzimanja" hint={myGls ? "Prozor mora trajati najmanje 2 sata." : undefined}>
                <Input
                  name="pickupEnd"
                  type="datetime-local"
                  required
                  defaultValue={formatBelgradeDateTimeLocal(batch.pickupWindowEnd)}
                />
              </Field>
              {editing ? (
                <div>
                  <SubmitButton pendingLabel="Čuvanje…">Sačuvaj termin</SubmitButton>
                </div>
              ) : null}
            </fieldset>
          </AdminActionForm>
          {postingBlockReason ? (
            <p
              id={postingReasonId}
              className="mt-4 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning"
            >
              <strong>„{myGls ? "Kreiraj adresnice" : "Proknjiži"}“ je trenutno zaključan:</strong>{" "}
              {postingBlockReason}
            </p>
          ) : myGls ? (
            <p className="mt-4 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
              MyGLS je spreman za kreiranje adresnica. Adresnica nije najava
              dolaska kurira; ručna najava se potvrđuje kao poseban korak ispod.
            </p>
          ) : (
            <p className="mt-4 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
              X Express je spreman. Proknjiži šalje najavu tek kada su svi paketi
              spakovani, označeni i spremni za preuzimanje.
            </p>
          )}

          {myGls && batch.labelsCreatedAt ? (
            <div className="mt-4 rounded-lg border border-border p-4">
              <h3 className="font-semibold">Ručna najava MyGLS prikupa</h3>
              {batch.externalBookedAt ? (
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  <div><dt className="text-ink-500">Potvrđeno</dt><dd>{formatDateTime(batch.externalBookedAt)}</dd></div>
                  <div><dt className="text-ink-500">Kanal</dt><dd>{bookingChannelLabel(batch.externalBookingChannel)}</dd></div>
                  <div><dt className="text-ink-500">Referenca</dt><dd className="font-mono">{batch.externalBookingReference ?? "—"}</dd></div>
                </dl>
              ) : (
                <>
                  <p className="mt-1 text-sm text-ink-500">
                    Ovo polje popuniti tek nakon što je GLS stvarno primio najavu
                    preko portala, emaila, telefona ili dogovorenog stalnog termina.
                  </p>
                  <AdminActionForm action={confirmMyGlsBookingAction} className="mt-3 grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-end">
                    <input type="hidden" name="batchId" value={batch.id} />
                    <Field label="Kanal najave">
                      <select name="channel" required className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">
                        {MYGLS_BOOKING_CHANNELS.map((channel) => (
                          <option key={channel} value={channel}>{MYGLS_BOOKING_CHANNEL_LABEL[channel]}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="GLS referenca / broj potvrde">
                      <Input name="reference" required maxLength={120} />
                    </Field>
                    <SubmitButton
                      pendingLabel="Evidentiranje…"
                      confirm="Potvrditi da je GLS zaista primio najavu? Samo kreirana adresnica nije dovoljna."
                    >
                      Potvrdi najavu
                    </SubmitButton>
                  </AdminActionForm>
                </>
              )}
            </div>
          ) : null}
        </Card>

        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <CardTitle description={`Učitavaju se sve nefiskalizovane, još neučitane cele DC porudžbine koje po stvarnoj težini i dimenzijama pripadaju kuriru ${myGls ? "MyGLS (preko 30 kg ili bar jedna stranica preko 60 cm)" : "X Express (do 30 kg i svaka stranica do 60 cm)"}. Mešovite i nepotpune porudžbine se preskaču. MyGLS paketi volumetrijske dimenzije preko 300 cm pripadaju II kategoriji i mogu imati doplatu, ali to ne blokira kreiranje adresnice.`}>
              Porudžbine za preuzimanje
            </CardTitle>
            {editing ? (
              <AdminActionForm
                action={loadOrdersAction}
                preserveValues
                className="flex items-end"
              >
                <input type="hidden" name="batchId" value={batch.id} />
                <SubmitButton pendingLabel="Učitavanje…">
                  Učitaj sve nefiskalizovane
                </SubmitButton>
              </AdminActionForm>
            ) : null}
          </div>

          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-[2200px] text-sm">
                <thead className="bg-muted-bg/70 text-left text-xs uppercase tracking-[0.08em] text-ink-500">
                  <tr>
                    <th className="px-3 py-3">Broj porudžbine</th>
                    <th className="px-3 py-3">Bar kod</th>
                    <th className="px-3 py-3">Šifra artikla</th>
                    <th className="px-3 py-3">Kolekcija</th>
                    <th className="px-3 py-3">Kratki opis artikla</th>
                    <th className="px-3 py-3">Kratki naziv artikla</th>
                    <th className="px-3 py-3">Atribut 1</th>
                    <th className="px-3 py-3">Atribut 2</th>
                    <th className="px-3 py-3">Atribut 3</th>
                    <th className="px-3 py-3">Atribut 4</th>
                    <th className="px-3 py-3">Boja 1</th>
                    <th className="px-3 py-3">Boja 2</th>
                    <th className="px-3 py-3">Paket / stvarne mere</th>
                    <th className="px-3 py-3 text-right">Količina</th>
                    {editing ? <th className="px-3 py-3">Komanda</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {rows.map((row) => (
                    <tr key={row.lineId}>
                      <td className="px-3 py-3 font-medium">
                        <Link
                          href={`/admin/erp/prodajni-nalozi/${row.orderId}`}
                          className="text-walnut hover:underline"
                        >
                          {row.orderNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-3">{display(row.barcode)}</td>
                      <td className="px-3 py-3 font-medium">{display(row.sku)}</td>
                      <td className="px-3 py-3">{display(row.collection)}</td>
                      <td className="max-w-72 px-3 py-3">{display(row.shortDescription)}</td>
                      <td className="px-3 py-3">{display(row.shortName)}</td>
                      <td className="px-3 py-3">{display(row.attribute1)}</td>
                      <td className="px-3 py-3">{display(row.attribute2)}</td>
                      <td className="px-3 py-3">{display(row.attribute3)}</td>
                      <td className="px-3 py-3">{display(row.attribute4)}</td>
                      <td className="px-3 py-3">{display(row.color1)}</td>
                      <td className="px-3 py-3">{display(row.color2)}</td>
                      <td className="px-3 py-3">
                        <div>
                          {editing ? (
                            <AdminActionForm action={savePackageAction} className="flex min-w-[500px] items-end gap-2">
                              <input type="hidden" name="batchId" value={batch.id} />
                              <input type="hidden" name="lineId" value={row.lineId} />
                              <PackageMeasureInput name="weightKg" label="kg" max={myGls ? 40 : 1000} step="0.001" value={row.weightKg} />
                              <PackageMeasureInput name="widthCm" label="Š" max={myGls ? 200 : 60} value={row.widthCm} />
                              <PackageMeasureInput name="depthCm" label="D" max={myGls ? 200 : 60} value={row.depthCm} />
                              <PackageMeasureInput name="heightCm" label="V" max={myGls ? 200 : 60} value={row.heightCm} />
                              <SubmitButton size="xs" pendingLabel="Čuvanje…">Sačuvaj mere</SubmitButton>
                            </AdminActionForm>
                          ) : (
                            <span className={row.measurementsComplete ? "text-ink-700" : "text-warning"}>
                              #{row.packageNo} · {formatPackageMeasurements(row)}
                            </span>
                          )}
                          {myGls && hasKnownMyGlsHardLimitViolation(row) ? (
                            <p className="mt-1 max-w-[500px] text-xs text-warning">
                              Stvarne mere prelaze MyGLS granicu od 40 kg ili 200 cm. Ispravite mere pre kreiranja adresnice.
                            </p>
                          ) : myGls && hasKnownMyGlsOversizeSurcharge(row) ? (
                            <p className="mt-1 max-w-[500px] text-xs text-ink-500">
                              II kategorija — volumetrijska dimenzija je preko 300 cm; MyGLS može obračunati doplatu. Adresnica nije blokirana.
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.qty}</td>
                      {editing ? (
                        <td className="px-3 py-3">
                          <AdminActionForm action={removeOrderAction}>
                            <input type="hidden" name="batchId" value={batch.id} />
                            <input type="hidden" name="orderId" value={row.orderId} />
                            <SubmitButton
                              size="sm"
                              variant="destructive"
                              pendingLabel="Uklanjanje…"
                              confirm={`Ukloniti porudžbinu ${row.orderNumber} iz naloga? Svi njeni redovi biće uklonjeni, a status vraćen u Kreirano.`}
                            >
                              Ukloni porudžbinu
                            </SubmitButton>
                          </AdminActionForm>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-ink-500">
              <p>Nalog još nema učitanih porudžbina.</p>
              <p className="mt-1 text-xs">
                {editing
                  ? "Kliknite „Učitaj sve nefiskalizovane“. Biće dodate samo neučitane kurirske porudžbine čiji su svi redovi u podrazumevanom DC magacinu i koje još nisu fiskalizovane."
                  : editable
                    ? "Kliknite „Uredi“, pa „Učitaj sve nefiskalizovane“."
                    : "Ovaj nalog više nije moguće dopunjavati."}
              </p>
            </div>
          )}
        </Card>

        <Link
          href="/admin/erp/preuzimanja"
          className="text-sm text-walnut hover:underline"
        >
          ← Nazad na pregled naloga za preuzimanje
        </Link>
      </div>
    </>
  );
}

function pickupLineRow(line: {
  id: string;
  orderId: string;
  packageNo: number;
  weightKg: unknown;
  widthCm: unknown;
  depthCm: unknown;
  heightCm: unknown;
  order: { id: string; number: string };
  orderItem: {
    sku: string;
    qty: number;
    name: string;
    collectionName: string | null;
    shortDescriptionSnapshot: string | null;
    shortNameSnapshot: string | null;
    attribute1: string | null;
    attribute2: string | null;
    attribute3: string | null;
    attribute4: string | null;
    color1: string | null;
    color2: string | null;
    product: {
      barcode: string | null;
      shortDescription: string | null;
      shortName: string | null;
      name: string;
      attribute1: string | null;
      attribute2: string | null;
      attribute3: string | null;
      attribute4: string | null;
      colorPrimary: string | null;
      colorSecondary: string | null;
      collection: { name: string } | null;
    } | null;
  } | null;
}) {
  const item = line.orderItem;
  const product = item?.product;
  const weightKg = measureNumber(line.weightKg);
  const widthCm = measureNumber(line.widthCm);
  const depthCm = measureNumber(line.depthCm);
  const heightCm = measureNumber(line.heightCm);
  return {
    lineId: line.id,
    orderId: line.order.id,
    orderNumber: line.order.number,
    barcode: product?.barcode ?? "",
    sku: item?.sku ?? "",
    collection: product?.collection?.name ?? item?.collectionName ?? "",
    shortDescription:
      product?.shortDescription ?? item?.shortDescriptionSnapshot ?? "",
    shortName: product?.shortName ?? item?.shortNameSnapshot ?? item?.name ?? "",
    attribute1: product?.attribute1 ?? item?.attribute1 ?? "",
    attribute2: product?.attribute2 ?? item?.attribute2 ?? "",
    attribute3: product?.attribute3 ?? item?.attribute3 ?? "",
    attribute4: product?.attribute4 ?? item?.attribute4 ?? "",
    color1: product?.colorPrimary ?? item?.color1 ?? "",
    color2: product?.colorSecondary ?? item?.color2 ?? "",
    qty: item?.qty ?? 0,
    packageNo: line.packageNo,
    weightKg,
    widthCm,
    depthCm,
    heightCm,
    measurementsComplete: [weightKg, widthCm, depthCm, heightCm].every(
      (value) => value != null && value > 0,
    ),
  };
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    dateStyle: "medium",
    timeZone: "Europe/Belgrade",
  }).format(value);
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Belgrade",
  }).format(value);
}

function bookingChannelLabel(value: string | null) {
  return value && value in MYGLS_BOOKING_CHANNEL_LABEL
    ? MYGLS_BOOKING_CHANNEL_LABEL[
        value as keyof typeof MYGLS_BOOKING_CHANNEL_LABEL
      ]
    : "—";
}

function measureNumber(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function formatPackageMeasurements(row: {
  weightKg: number | null;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
}) {
  if ([row.weightKg, row.widthCm, row.depthCm, row.heightCm].some((value) => value == null)) {
    return "mere nisu kompletne";
  }
  return `${row.weightKg} kg · ${row.widthCm}×${row.depthCm}×${row.heightCm} cm`;
}

function PackageMeasureInput({
  name,
  label,
  max,
  step = "0.01",
  value,
}: {
  name: string;
  label: string;
  max: number;
  step?: string;
  value: number | null;
}) {
  return (
    <label className="grid gap-1 text-xs text-ink-500">
      {label}
      <input
        name={name}
        type="number"
        min={step}
        max={max}
        step={step}
        required
        defaultValue={value ?? ""}
        className="h-7 w-16 rounded-md border border-input bg-transparent px-2 text-xs text-ink-900"
      />
    </label>
  );
}

function display(value: string) {
  return value || "—";
}

function pickupLoadMessage(
  result: Awaited<ReturnType<typeof loadEligibleOrders>>,
) {
  const skipped = [
    result.skippedOtherProviderCount
      ? `${result.skippedOtherProviderCount} za drugog kurira`
      : null,
    result.skippedMixedCount
      ? `${result.skippedMixedCount} mešovitih`
      : null,
    result.skippedInvalidDimensionsCount
      ? `${result.skippedInvalidDimensionsCount} bez kompletne težine ili dimenzija`
      : null,
  ].filter(Boolean);
  const loaded = result.lineCount
    ? `Učitano redova: ${result.lineCount} iz ${result.orderCount} porudžbina.`
    : "Nema novih porudžbina koje odgovaraju ovom kuriru i pravilima DC rezervacije.";
  const correction = result.loadedMyGlsHardLimitCount
    ? `Za ${result.loadedMyGlsHardLimitCount} učitanih MyGLS porudžbina unesite stvarne transportne mere unutar granice od 40 kg i 200 cm.`
    : null;
  const surcharge = result.loadedMyGlsOversizeSurchargeCount
    ? `${result.loadedMyGlsOversizeSurchargeCount} učitanih MyGLS porudžbina pripada II kategoriji i može imati doplatu.`
    : null;
  return [
    loaded,
    skipped.length ? `Preskočeno: ${skipped.join(", ")}.` : null,
    correction,
    surcharge,
  ]
    .filter(Boolean)
    .join(" ");
}

function revalidatePickupPaths(batchId: string) {
  revalidatePath(`/admin/erp/preuzimanja/${batchId}`);
  revalidatePath("/admin/erp/preuzimanja");
  revalidatePath("/admin/erp/prodajni-nalozi");
}

function isIdResult(value: unknown): value is { id: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string"
  );
}
