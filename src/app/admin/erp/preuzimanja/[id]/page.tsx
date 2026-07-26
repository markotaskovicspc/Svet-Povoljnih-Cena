import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AdminActionForm } from "@/components/admin/action-form";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { PageHeader } from "@/components/admin/page-header";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { AdminActionState } from "@/lib/admin/action-state";
import { requireAdminAction, withAdminState } from "@/lib/admin";
import {
  createPickupBatch,
  deletePickupBatches,
  getPickupPostingAvailability,
  loadEligibleOrders,
  postPickupBatches,
  removeOrderFromPickupBatch,
  savePickupDate,
} from "@/lib/admin/pickup-batch.server";
import {
  isPickupBatchEditable,
  PICKUP_BATCH_STATUS_LABEL,
} from "@/lib/admin/pickup-batch";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Nalog za preuzimanje · ERP",
  robots: { index: false, follow: false },
};

const saveDateSchema = z.object({
  batchId: z.string().min(1),
  pickupDate: z.iso.date("Datum preuzimanja je obavezan."),
});

const batchSchema = z.object({ batchId: z.string().min(1) });
const removeOrderSchema = batchSchema.extend({ orderId: z.string().min(1) });

async function createAction() {
  "use server";
  const state = await withAdminState(
    {
      allowed: ["OPS"],
      action: "pickup-batch.create",
      entity: "PickupBatch",
    },
    async () => {
      const batch = await createPickupBatch();
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
      const date = new Date(`${parsed.data.pickupDate}T00:00:00.000Z`);
      await savePickupDate(parsed.data.batchId, date);
      revalidatePickupPaths(parsed.data.batchId);
      return {
        ok: true as const,
        entityId: parsed.data.batchId,
        message: "Datum preuzimanja je sačuvan.",
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
        message: result.lineCount
          ? `Učitano redova: ${result.lineCount} iz ${result.orderCount} porudžbina.`
          : "Nema novih kreiranih kurirskih porudžbina sa redovima u DC magacinu.",
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
      const result = await postPickupBatches([parsed.data.batchId], actorId);
      revalidatePickupPaths(parsed.data.batchId);
      return {
        ok: true as const,
        entityId: parsed.data.batchId,
        diff: result,
        message: `Nalog je proknjižen; X Express pošiljki: ${result.shipmentCount}.`,
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

  const editable = isPickupBatchEditable(batch.status);
  const posting = await getPickupPostingAvailability();
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
            <form action={createAction}>
              <SubmitButton variant="outline" pendingLabel="Kreiranje…">
                Novi
              </SubmitButton>
            </form>
            {editable ? (
              editing ? (
                <Link
                  href={`/admin/erp/preuzimanja/${batch.id}`}
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
                >
                  Završi uređivanje
                </Link>
              ) : (
                <Link
                  href={`/admin/erp/preuzimanja/${batch.id}?mode=edit`}
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
                >
                  Uredi
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
                  !editable ||
                  !rows.length ||
                  !batch.pickupDate ||
                  !posting.available
                }
                pendingLabel="Knjiženje…"
                confirm="Proknjižiti nalog i poslati po jednu najavu za svaku porudžbinu X Express-u? Pošiljke moraju biti spakovane, označene i spremne za preuzimanje."
                title={posting.reason ?? undefined}
              >
                Proknjiži
              </SubmitButton>
            </AdminActionForm>
          </div>
        }
      />

      <div className="space-y-6 px-4 py-6 md:px-8">
        <Card>
          <CardTitle description="Zaglavlje naloga koje ostaje izmenjivo dok nalog nije proknjižen.">
            Podaci naloga
          </CardTitle>
          <div className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
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
          </div>
          <AdminActionForm action={saveDateAction}>
            <fieldset disabled={!editing} className="grid gap-4 md:grid-cols-[minmax(0,320px)_auto] md:items-end">
              <input type="hidden" name="batchId" value={batch.id} />
              <Field label="Datum preuzimanja">
                <Input
                  name="pickupDate"
                  type="date"
                  required
                  defaultValue={dateOnly(batch.pickupDate)}
                />
              </Field>
              {editing ? (
                <div>
                  <SubmitButton pendingLabel="Čuvanje…">Sačuvaj datum</SubmitButton>
                </div>
              ) : null}
            </fieldset>
          </AdminActionForm>
          {posting.reason ? (
            <p className="mt-4 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
              {posting.reason}
            </p>
          ) : (
            <p className="mt-4 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
              X Express je spreman. Proknjiži šalje najavu tek kada su svi paketi
              spakovani, označeni i spremni za preuzimanje.
            </p>
          )}
        </Card>

        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <CardTitle description="Učitavaju se samo kreirane kurirske porudžbine sa redovima u podrazumevanom DC magacinu. Porudžbina koja je već u bilo kom nalogu preskače se.">
              Porudžbine za preuzimanje
            </CardTitle>
            {editing ? (
              <AdminActionForm action={loadOrdersAction}>
                <input type="hidden" name="batchId" value={batch.id} />
                <SubmitButton pendingLabel="Učitavanje…">
                  Učitaj porudžbine
                </SubmitButton>
              </AdminActionForm>
            ) : null}
          </div>

          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-[1900px] text-sm">
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
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-ink-500">
              Nalog još nema učitanih porudžbina.
            </p>
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
  };
}

function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? "";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    dateStyle: "medium",
    timeZone: "Europe/Belgrade",
  }).format(value);
}

function display(value: string) {
  return value || "—";
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
