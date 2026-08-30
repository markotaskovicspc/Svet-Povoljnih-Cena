import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AdminActionForm } from "@/components/admin/action-form";
import { Card, CardTitle } from "@/components/admin/card";
import { PageHeader } from "@/components/admin/page-header";
import { PendingLinkLabel } from "@/components/admin/pending-link-label";
import { SubmitButton } from "@/components/admin/submit-button";
import { Button } from "@/components/ui/button";
import type { AdminActionState } from "@/lib/admin/action-state";
import { requireAdminAction, withAdminState } from "@/lib/admin";
import {
  deletePickupBatches,
  getPickupPostingAvailability,
  loadEligibleOrders,
  postPickupBatches,
  removePickupGroupFromBatch,
  savePickupPackage,
  updatePickupBatchCourierHandover,
} from "@/lib/admin/pickup-batch.server";
import {
  isPickupBatchEditable,
  pickupBatchDisplayStatus,
  pickupBatchHandoverProgress,
  pickupPostingBlockReason,
} from "@/lib/admin/pickup-batch";
import {
  hasKnownMyGlsHardLimitViolation,
  hasKnownMyGlsOversizeSurcharge,
  hasKnownXExpressHardLimitViolation,
} from "@/lib/courier/packages";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Nalog za preuzimanje · ERP",
  robots: { index: false, follow: false },
};

const batchSchema = z.object({ batchId: z.string().min(1) });
const removeGroupSchema = batchSchema.extend({ lineGroupKey: z.string().min(1) });
const packageSchema = batchSchema.extend({
  lineId: z.string().min(1),
  weightKg: z.coerce.number().positive().max(1000),
  widthCm: z.coerce.number().positive().max(500),
  depthCm: z.coerce.number().positive().max(500),
  heightCm: z.coerce.number().positive().max(500),
});

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
      const parsed = batchSchema.safeParse(
        Object.fromEntries(actionData.entries()),
      );
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

async function removeGroupAction(
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
      const parsed = removeGroupSchema.safeParse(
        Object.fromEntries(actionData.entries()),
      );
      if (!parsed.success) {
        return { ok: false as const, error: "Picking grupa nije izabrana." };
      }
      const result = await removePickupGroupFromBatch(
        parsed.data.batchId,
        parsed.data.lineGroupKey,
        actorId,
      );
      revalidatePickupPaths(parsed.data.batchId);
      return {
        ok: true as const,
        entityId: parsed.data.batchId,
        diff: result,
        message: `Picking grupa je uklonjena; obrisano paketa: ${result.removedLineCount}.`,
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
      const result = await postPickupBatches([parsed.data.batchId], actorId);
      revalidatePickupPaths(parsed.data.batchId);
      return {
        ok: true as const,
        entityId: parsed.data.batchId,
        diff: result,
        message: `Nalog je proknjižen; ${result.shipmentCount} pošiljki je uspešno poslato u sistem kurira, a adresnice su spremne za štampu.`,
      };
    },
  )(formData);
}

async function updateCourierHandoverAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "pickup-batch.courier-handover.update",
      entity: "PickupBatch",
    },
    async (actorId, actionData: FormData) => {
      const parsed = batchSchema.safeParse({
        batchId: actionData.get("batchId"),
      });
      const pickedUpGroupKeys = actionData
        .getAll("pickedUpGroupKeys")
        .map(String)
        .map((key) => key.trim())
        .filter(Boolean);
      if (!parsed.success || pickedUpGroupKeys.length > 500) {
        return { ok: false as const, error: "Izbor pošiljki nije ispravan." };
      }
      const result = await updatePickupBatchCourierHandover(
        parsed.data.batchId,
        pickedUpGroupKeys,
        actorId,
      );
      revalidatePickupPaths(parsed.data.batchId);
      return {
        ok: true as const,
        entityId: parsed.data.batchId,
        diff: result,
        message: result.complete
          ? `Kurir je evidentiran za sve pošiljke (${result.pickedUpGroupCount}/${result.totalGroupCount}) i pakete (${result.pickedUpPackageCount}/${result.totalPackageCount}).`
          : result.pickedUpGroupCount > 0
            ? `Sačuvano je delimično preuzimanje: ${result.pickedUpGroupCount}/${result.totalGroupCount} pošiljki i ${result.pickedUpPackageCount}/${result.totalPackageCount} paketa.`
            : "Evidencija preuzimanja je poništena; nijedna pošiljka nije označena kao preuzeta.",
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
          reclamation: {
            select: {
              number: true,
              warehouseStatus: true,
              warehouse: { select: { code: true, name: true } },
            },
          },
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
    isPickupBatchEditable(batch.status);
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
  const pickingGroups = aggregatePickupGroups(rows);
  const handoverProgress = pickupBatchHandoverProgress(rows);
  const handoverStatus = pickupBatchDisplayStatus(
    batch.status,
    handoverProgress,
  );
  const canRecordCourierHandover =
    batch.status === "BOOKED" || batch.status === "PICKED_UP";
  const legacyCompleteHandover =
    batch.status === "PICKED_UP" && handoverProgress.pickedUpPackages === 0;
  const handoverFormId = `courier-handover-${batch.id}`;
  const completePackageCount = rows.filter((row) => row.measurementsComplete).length;
  const invalidPackageCount = rows.filter((row) =>
    myGls
      ? hasKnownMyGlsHardLimitViolation(row)
      : hasKnownXExpressHardLimitViolation(row),
  ).length;
  const unreadyReplacementCount = pickingGroups.filter(
    (group) =>
      group.purpose === "RECLAMATION_REPLACEMENT" &&
      group.warehouseStatus !== "READY",
  ).length;
  const postingBlockReason = unreadyReplacementCount
    ? `${unreadyReplacementCount} zamena još nema status magacina „Spremno“. Otvorite reklamaciju i završite pripremu pre knjiženja.`
    : pickupPostingBlockReason({
        configurationIssue: batch.labelsCreationStartedAt
          ? batch.configurationIssue
          : null,
        providerReason: posting.reason,
        provider: posting.provider,
        rowCount: rows.length,
        completePackageCount,
        invalidPackageCount,
      });
  const postingReasonId = "pickup-posting-block-reason";

  return (
    <>
      <PageHeader
        title={`Nalog za preuzimanje ${batch.number}`}
        description={`${handoverStatus} · ${pickingGroups.length} picking grupa · ${rows.length} paketa`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { href: "/admin/erp/preuzimanja", label: "Nalozi za preuzimanje" },
          { label: batch.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/admin/erp/preuzimanja/${batch.id}/stampa?section=picking&autoprint=1`}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
            >
              Samostalna picking lista
            </Link>
            {batch.labelsCreatedAt ? (
              <Link
                href={`/api/admin/erp/preuzimanja/${batch.id}/labels`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
              >
                Kurirske adresnice
              </Link>
            ) : (
              <span
                aria-disabled="true"
                title="Prvo kliknite „Kreiraj adresnice i pošalji“."
                className="inline-flex h-8 cursor-not-allowed items-center rounded-lg border border-border bg-muted px-2.5 text-sm font-medium text-ink-400 opacity-70"
              >
                Kurirske adresnice
              </span>
            )}
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
              <Button
                type="button"
                variant="outline"
                disabled
                title={
                  batch.status === "DRAFT" && batch.labelsCreationStartedAt
                    ? "Mere i sastav naloga ostaju zaključani posle početka izrade adresnica. Adresu ili telefon ispravite u povezanom prodajnom nalogu."
                    : undefined
                }
              >
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
            <AdminActionForm
              action={postAction}
              successPopupUrl={`/admin/erp/preuzimanja/${batch.id}/stampa?section=labels`}
              popupWindowName={`pickup-print-${batch.id}`}
            >
              <input type="hidden" name="batchId" value={batch.id} />
              <SubmitButton
                variant="outline"
                disabled={
                  !canPost ||
                  !rows.length ||
                  !posting.available ||
                  unreadyReplacementCount > 0 ||
                  completePackageCount !== rows.length ||
                  invalidPackageCount > 0
                }
                pendingLabel="Slanje kuriru…"
                confirm={`Kreirati adresnice i odmah poslati sve pošiljke ${myGls ? "MyGLS-u" : "X Express-u"}? Nakon uspešnog API poziva nalog će biti proknjižen.`}
                title={postingBlockReason ?? undefined}
                aria-describedby={postingBlockReason ? postingReasonId : undefined}
              >
                Kreiraj adresnice i pošalji
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
                  ? "Ovo je pregled naloga. Kliknite „Uredi“ da učitate porudžbine ili unesete mere paketa."
                  : batch.status === "DRAFT" && batch.labelsCreationStartedAt
                    ? "Mere i sastav naloga su zaključani jer je izrada adresnica započeta. Adresu ili telefon kupca i dalje možete ispraviti u povezanom prodajnom nalogu."
                    : "Nalog je zaključan za izmene jer više nije u statusu Novi."
            }
          >
            Podaci naloga
          </CardTitle>
          <div className="mb-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-lg bg-muted-bg/50 p-3">
              <p className="text-ink-500">Status</p>
              <p className="font-semibold">{handoverStatus}</p>
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
          <div className="mb-4 rounded-lg border border-border px-3 py-3 text-sm text-ink-700">
            <p className="font-semibold">
              {myGls ? "Redosled za MyGLS" : "Redosled za X Express"}
            </p>
            <p className="mt-1 leading-6">
              1. Učitajte porudžbine i proverite stvarne mere. 2. Kliknite
              „Kreiraj adresnice i pošalji“. 3. Sistem automatski šalje sve
              pošiljke kuriru i proknjižava nalog. 4. Otvorite „Kurirske
              adresnice“, odštampajte ih i zalepite na pakete.
            </p>
          </div>
          {canRecordCourierHandover ? (
            <p
              className={
                handoverStatus === "Delimično preuzeta"
                  ? "mt-4 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning"
                  : "mt-4 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success"
              }
            >
              {handoverStatus === "Kompletno preuzeta"
                ? `Kurir je preuzeo sve pošiljke i pakete (${handoverProgress.totalGroups}/${handoverProgress.totalGroups} pošiljki · ${handoverProgress.totalPackages}/${handoverProgress.totalPackages} paketa).`
                : handoverStatus === "Delimično preuzeta"
                  ? `Kurir je preuzeo ${handoverProgress.pickedUpGroups}/${handoverProgress.totalGroups} pošiljki i ${handoverProgress.pickedUpPackages}/${handoverProgress.totalPackages} paketa.`
                  : "Adresnice su kreirane, pošiljke su poslate kuriru i nalog je proknjižen. Evidentirajte preuzimanje u picking listi kada kurir fizički preuzme pošiljke."}
            </p>
          ) : postingBlockReason ? (
            <p
              id={postingReasonId}
              className="mt-4 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning"
            >
              <strong>
                „Kreiraj adresnice i pošalji“ je trenutno zaključan:
              </strong>{" "}
              {postingBlockReason}
              {batch.status === "DRAFT" && batch.labelsCreationStartedAt ? (
                <span className="mt-1 block">
                  Ako poruka navodi adresu ili telefon, kliknite broj
                  porudžbine u picking listi, ispravite podatke u odeljku
                  „Adresa isporuke“, vratite se ovde i ponovite slanje.
                </span>
              ) : null}
            </p>
          ) : (
            <p className="mt-4 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
              {myGls ? "MyGLS" : "X Express"} je spreman. Jedan klik kreira
              adresnice i odmah šalje sve pošiljke kuriru.
            </p>
          )}
        </Card>

        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <CardTitle description={`Učitavaju se sve neučitane, nefiskalizovane DC porudžbine koje po stvarnoj težini i dimenzijama pripadaju kuriru ${myGls ? "MyGLS (preko 30 kg, bar jedna stranica preko 60 cm ili porudžbina sa različitim veličinama paketa)" : "X Express (svi paketi do 30 kg i do 60 cm po svakoj strani)"}. Cela porudžbina ostaje u jednom nalogu, pa picking lista prikazuje sve njene artikle. Zamene ulaze u isti picking tok. MyGLS volumetrijska dimenzija preko 300 cm može imati doplatu, ali ne blokira adresnicu.`}>
              Zajednička picking lista
            </CardTitle>
            {editing ? (
              <AdminActionForm
                action={loadOrdersAction}
                className="flex items-end"
              >
                <input type="hidden" name="batchId" value={batch.id} />
                <SubmitButton pendingLabel="Učitavanje…">
                  Učitaj porudžbine
                </SubmitButton>
              </AdminActionForm>
            ) : canRecordCourierHandover ? (
              <div className="flex flex-wrap items-end justify-end gap-2">
                <AdminActionForm
                  id={handoverFormId}
                  action={updateCourierHandoverAction}
                  preserveValues
                  className="flex flex-wrap items-center justify-end gap-2"
                >
                  <input type="hidden" name="batchId" value={batch.id} />
                  <span className="text-xs text-ink-500">
                    {handoverProgress.pickedUpGroups}/{handoverProgress.totalGroups}{" "}
                    pošiljki · {handoverProgress.pickedUpPackages}/
                    {handoverProgress.totalPackages} paketa
                  </span>
                  <SubmitButton
                    size="sm"
                    pendingLabel="Čuvanje…"
                    confirm="Sačuvati označene pošiljke kao fizički preuzete od strane kurira?"
                  >
                    Sačuvaj preuzimanje
                  </SubmitButton>
                </AdminActionForm>
                <AdminActionForm
                  action={updateCourierHandoverAction}
                  className="flex items-center"
                >
                  <input type="hidden" name="batchId" value={batch.id} />
                  {pickingGroups.map((group) => (
                    <input
                      key={group.lineGroupKey}
                      type="hidden"
                      name="pickedUpGroupKeys"
                      value={group.lineGroupKey}
                    />
                  ))}
                  <SubmitButton
                    size="sm"
                    variant="outline"
                    pendingLabel="Čuvanje…"
                    confirm={`Potvrditi da je kurir preuzeo svih ${pickingGroups.length} pošiljki i ${rows.length} paketa?`}
                  >
                    Sve preuzeto
                  </SubmitButton>
                </AdminActionForm>
              </div>
            ) : null}
          </div>

          {pickingGroups.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted-bg/70 text-left text-xs uppercase tracking-[0.08em] text-ink-500">
                  <tr>
                    <th className="px-3 py-3">Izvor</th>
                    <th className="px-3 py-3">Artikli za picking</th>
                    <th className="px-3 py-3 text-right">Paketa</th>
                    <th className="px-3 py-3">Stvarne mere paketa</th>
                    {canRecordCourierHandover ? (
                      <th className="px-3 py-3 text-center">Kurir preuzeo</th>
                    ) : null}
                    {editing ? <th className="px-3 py-3">Komanda</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {pickingGroups.map((group) => (
                    <tr key={group.lineGroupKey} className="align-top">
                      <td className="px-3 py-3">
                        <Link
                          href={
                            group.reclamationId
                              ? `/admin/erp/reklamacije-dnevnik/${group.reclamationId}`
                              : `/admin/erp/prodajni-nalozi/${group.orderId}`
                          }
                          className="font-medium text-walnut hover:underline"
                        >
                          {group.sourceLabel}
                        </Link>
                        <p className="mt-1 text-xs text-ink-500">
                          {group.purpose === "RECLAMATION_REPLACEMENT"
                            ? `Zamena · ${group.warehouseLabel ?? "magacin nije izabran"}`
                            : "Isporuka porudžbine"}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <ul className="space-y-2">
                          {group.items.map((item) => (
                            <li key={item.key}>
                              <span className="font-mono font-semibold">{display(item.sku)}</span>{" "}
                              <span>{display(item.name)}</span>{" "}
                              <strong className="whitespace-nowrap">× {item.quantity}</strong>
                              <p className="text-xs text-ink-500">
                                {[item.barcode, item.collection, item.description, item.attributes]
                                  .filter(Boolean)
                                  .join(" · ") || "Bez dodatnih podataka"}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-3 py-3 text-right text-lg font-semibold tabular-nums">
                        {group.rows.length}
                      </td>
                      <td className="px-3 py-3">
                        <details open={group.rows.some((row) => !row.measurementsComplete)}>
                          <summary className="cursor-pointer font-medium">
                            {group.completePackageCount}/{group.rows.length} kompletno
                          </summary>
                          <div className="mt-2 space-y-3">
                            {group.rows.map((row) => (
                              <div key={row.lineId}>
                                {editing ? (
                                  <AdminActionForm action={savePackageAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2">
                                    <input type="hidden" name="batchId" value={batch.id} />
                                    <input type="hidden" name="lineId" value={row.lineId} />
                                    <span className="pb-1 text-xs font-semibold">#{row.packageNo}</span>
                                    <PackageMeasureInput name="weightKg" label="kg" max={myGls ? 40 : 30} step="0.001" value={row.weightKg} />
                                    <PackageMeasureInput name="widthCm" label="Š" max={myGls ? 200 : 60} value={row.widthCm} />
                                    <PackageMeasureInput name="depthCm" label="D" max={myGls ? 200 : 60} value={row.depthCm} />
                                    <PackageMeasureInput name="heightCm" label="V" max={myGls ? 200 : 60} value={row.heightCm} />
                                    <SubmitButton size="xs" pendingLabel="Čuvanje…">Sačuvaj</SubmitButton>
                                  </AdminActionForm>
                                ) : (
                                  <p className={row.measurementsComplete ? "text-ink-700" : "text-warning"}>
                                    #{row.packageNo} · {formatPackageMeasurements(row)}
                                  </p>
                                )}
                                {myGls && hasKnownMyGlsHardLimitViolation(row) ? (
                                  <p className="mt-1 text-xs text-warning">
                                    Stvarne mere prelaze MyGLS granicu od 40 kg ili 200 cm. Ispravite mere pre kreiranja adresnice.
                                  </p>
                                ) : myGls && hasKnownMyGlsOversizeSurcharge(row) ? (
                                  <p className="mt-1 text-xs text-ink-500">
                                    II kategorija — volumetrijska dimenzija je preko 300 cm; MyGLS može obračunati doplatu.
                                  </p>
                                ) : !myGls && hasKnownXExpressHardLimitViolation(row) ? (
                                  <p className="mt-1 text-xs text-warning">
                                    Stvarne mere prelaze X Express granicu od 30 kg ili 60 cm. Prebacite porudžbinu u MyGLS nalog.
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </details>
                      </td>
                      {canRecordCourierHandover ? (
                        <td className="px-3 py-3 text-center">
                          <label className="inline-flex cursor-pointer flex-col items-center gap-1">
                            <input
                              type="checkbox"
                              name="pickedUpGroupKeys"
                              value={group.lineGroupKey}
                              form={handoverFormId}
                              defaultChecked={
                                group.courierPickedUp || legacyCompleteHandover
                              }
                              aria-label={`Kurir preuzeo ${group.sourceLabel}`}
                              className="size-4 accent-brand-blue"
                            />
                            <span className="text-xs font-medium text-ink-700">
                              {group.courierPickedUp || legacyCompleteHandover
                                ? "Da"
                                : "Ne"}
                            </span>
                            {group.courierPickedUpAt ? (
                              <span className="whitespace-nowrap text-[11px] text-ink-500">
                                {formatDateTime(group.courierPickedUpAt)}
                              </span>
                            ) : null}
                          </label>
                        </td>
                      ) : null}
                      {editing ? (
                        <td className="px-3 py-3">
                          <AdminActionForm action={removeGroupAction}>
                            <input type="hidden" name="batchId" value={batch.id} />
                            <input type="hidden" name="lineGroupKey" value={group.lineGroupKey} />
                            <SubmitButton
                              size="sm"
                              variant="destructive"
                              pendingLabel="Uklanjanje…"
                              confirm={`Ukloniti ${group.sourceLabel} iz ovog ${myGls ? "MyGLS" : "X Express"} naloga?`}
                            >
                              Ukloni grupu
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
                  ? "Kliknite „Učitaj porudžbine“. Biće dodate sve neučitane, nefiskalizovane DC porudžbine koje pripadaju ovom kuriru; porudžbina sa različitim veličinama paketa ide cela MyGLS-u."
                  : editable
                    ? "Kliknite „Uredi“, pa „Učitaj porudžbine“."
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
  orderItemId: string | null;
  reclamationId: string | null;
  purpose: "ORDER_DELIVERY" | "RECLAMATION_RETURN" | "RECLAMATION_REPLACEMENT";
  lineGroupKey: string;
  quantity: number | null;
  packageNo: number;
  weightKg: unknown;
  widthCm: unknown;
  depthCm: unknown;
  heightCm: unknown;
  courierPickedUpAt: Date | null;
  courierPickedUpById: string | null;
  order: { id: string; number: string };
  reclamation: {
    number: string;
    warehouseStatus: string;
    warehouse: { code: string; name: string } | null;
  } | null;
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
    lineGroupKey: line.lineGroupKey,
    purpose: line.purpose,
    reclamationId: line.reclamationId,
    reclamationNumber: line.reclamation?.number ?? null,
    warehouseStatus: line.reclamation?.warehouseStatus ?? null,
    warehouseLabel: line.reclamation?.warehouse
      ? `${line.reclamation.warehouse.code} · ${line.reclamation.warehouse.name}`
      : null,
    orderItemId: line.orderItemId,
    orderId: line.order.id,
    orderNumber: line.order.number,
    barcode: product?.barcode ?? "",
    sku: item?.sku ?? "",
    collection: product?.collection?.name ?? item?.collectionName ?? "",
    shortDescription:
      product?.shortDescription ?? item?.shortDescriptionSnapshot ?? "",
    shortName: item?.name ?? "",
    attribute1: product?.attribute1 ?? item?.attribute1 ?? "",
    attribute2: product?.attribute2 ?? item?.attribute2 ?? "",
    attribute3: product?.attribute3 ?? item?.attribute3 ?? "",
    attribute4: product?.attribute4 ?? item?.attribute4 ?? "",
    color1: product?.colorPrimary ?? item?.color1 ?? "",
    color2: product?.colorSecondary ?? item?.color2 ?? "",
    qty: line.quantity ?? item?.qty ?? 0,
    packageNo: line.packageNo,
    courierPickedUpAt: line.courierPickedUpAt,
    courierPickedUpById: line.courierPickedUpById,
    weightKg,
    widthCm,
    depthCm,
    heightCm,
    measurementsComplete: [weightKg, widthCm, depthCm, heightCm].every(
      (value) => value != null && value > 0,
    ),
  };
}

function aggregatePickupGroups(rows: ReturnType<typeof pickupLineRow>[]) {
  const groups = new Map<
    string,
    {
      lineGroupKey: string;
      orderId: string;
      orderNumber: string;
      reclamationId: string | null;
      purpose: ReturnType<typeof pickupLineRow>["purpose"];
      sourceLabel: string;
      warehouseLabel: string | null;
      warehouseStatus: string | null;
      rows: ReturnType<typeof pickupLineRow>[];
    }
  >();
  for (const row of rows) {
    const group = groups.get(row.lineGroupKey) ?? {
      lineGroupKey: row.lineGroupKey,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      reclamationId: row.reclamationId,
      purpose: row.purpose,
      sourceLabel:
        row.purpose === "RECLAMATION_REPLACEMENT"
          ? `Zamena · ${row.reclamationNumber ?? row.orderNumber}`
          : row.orderNumber,
      warehouseLabel: row.warehouseLabel,
      warehouseStatus: row.warehouseStatus,
      rows: [],
    };
    group.rows.push(row);
    groups.set(row.lineGroupKey, group);
  }
  return [...groups.values()].map((group) => {
    const items = new Map<
      string,
      {
        key: string;
        sku: string;
        name: string;
        quantity: number;
        barcode: string;
        collection: string;
        description: string;
        attributes: string;
      }
    >();
    for (const row of group.rows) {
      const key = row.orderItemId ?? `package:${row.lineId}`;
      if (items.has(key)) continue;
      items.set(key, {
        key,
        sku: row.sku,
        name: row.shortName,
        quantity: row.qty,
        barcode: row.barcode,
        collection: row.collection,
        description: row.shortDescription,
        attributes: [
          row.attribute1,
          row.attribute2,
          row.attribute3,
          row.attribute4,
          row.color1,
          row.color2,
        ]
          .filter(Boolean)
          .join(" / "),
      });
    }
    return {
      ...group,
      rows: group.rows.sort((left, right) => left.packageNo - right.packageNo),
      items: [...items.values()],
      completePackageCount: group.rows.filter((row) => row.measurementsComplete)
        .length,
      courierPickedUp:
        group.rows.length > 0 &&
        group.rows.every((row) => Boolean(row.courierPickedUpAt)),
      courierPickedUpAt:
        group.rows.length > 0 &&
        group.rows.every((row) => Boolean(row.courierPickedUpAt))
          ? new Date(
              Math.max(
                ...group.rows.map((row) =>
                  row.courierPickedUpAt?.getTime() ?? 0,
                ),
              ),
            )
          : null,
    };
  });
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
  const skippedPaymentOrderSummary = result.skippedPaymentOrderNumbers.length
    ? `${result.skippedPaymentOrderNumbers.slice(0, 5).join(", ")}${
        result.skippedPaymentOrderNumbers.length > 5
          ? ` i još ${result.skippedPaymentOrderNumbers.length - 5}`
          : ""
      }`
    : "";
  const skipped = [
    result.skippedPaymentCount
      ? `${result.skippedPaymentCount} koje čekaju potvrdu plaćanja (${skippedPaymentOrderSummary})`
      : null,
    result.skippedOtherProviderCount
      ? `${result.skippedOtherProviderCount} za drugog kurira`
      : null,
    result.skippedInvalidDimensionsCount
      ? `${result.skippedInvalidDimensionsCount} bez kompletne težine ili dimenzija`
      : null,
  ].filter(Boolean);
  const loaded = result.lineCount
    ? `Učitano paketa: ${result.lineCount} iz ${result.orderCount} porudžbina.`
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
