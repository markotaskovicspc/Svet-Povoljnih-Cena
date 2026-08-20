import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DispatchNoteType } from "@prisma/client";
import { z } from "zod";
import { AdminActionForm } from "@/components/admin/action-form";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { PageHeader } from "@/components/admin/page-header";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AdminActionState } from "@/lib/admin/action-state";
import { requireAdminAction, withAdminState } from "@/lib/admin";
import {
  addStocktakeDispatchItem,
  postStocktakeDispatches,
  removeStocktakeDispatchItem,
  saveStocktakeDispatchHeader,
  updateStocktakeDispatchItem,
} from "@/lib/admin/stocktake-dispatch.server";
import {
  isStocktakeDispatchEditable,
  STOCKTAKE_DESTINATION_NAME,
  STOCKTAKE_STATUS_LABEL,
} from "@/lib/admin/stocktake-dispatch";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Popis · ERP",
  robots: { index: false, follow: false },
};

const headerSchema = z.object({
  dispatchId: z.string().min(1),
  sourceWarehouseId: z.string().min(1, "Izvorni magacin je obavezan."),
  notes: z.string().trim().max(2000, "Napomena može imati najviše 2.000 znakova."),
});

const addItemSchema = z.object({
  dispatchId: z.string().min(1),
  sku: z.string().trim().min(1, "Šifra artikla je obavezna.").max(100),
  qty: z.coerce
    .number()
    .int()
    .nonnegative("Prebrojana količina mora biti nenegativan ceo broj."),
});

const itemSchema = z.object({
  dispatchId: z.string().min(1),
  itemId: z.string().min(1),
  qty: z.coerce
    .number()
    .int()
    .nonnegative("Prebrojana količina mora biti nenegativan ceo broj."),
});

const removeItemSchema = z.object({
  dispatchId: z.string().min(1),
  itemId: z.string().min(1),
});

const dispatchSchema = z.object({ dispatchId: z.string().min(1) });

function revalidateStocktake(id: string) {
  revalidatePath(`/admin/erp/popisi/${id}`);
  revalidatePath("/admin/erp/popisi");
  revalidatePath("/admin/erp/otpremnice");
  revalidatePath("/admin/erp/stanje-po-magacinima");
  revalidatePath("/admin/erp/kretanja-zaliha");
}

async function saveHeaderAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "stocktake-dispatch.header.save",
      entity: "DispatchNote",
    },
    async (_actorId, actionData: FormData) => {
      const parsed = headerSchema.safeParse(Object.fromEntries(actionData.entries()));
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Podaci popisa nisu ispravni.",
        };
      }
      const data = parsed.data;
      await saveStocktakeDispatchHeader({
        id: data.dispatchId,
        sourceWarehouseId: data.sourceWarehouseId,
        notes: data.notes || null,
      });
      revalidateStocktake(data.dispatchId);
      return {
        ok: true as const,
        entityId: data.dispatchId,
        diff: {
          sourceWarehouseId: data.sourceWarehouseId,
          destinationName: STOCKTAKE_DESTINATION_NAME,
        },
        message: "Podaci popisa su sačuvani.",
      };
    },
  )(formData);
}

async function addItemAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "stocktake-dispatch.item.add",
      entity: "DispatchNoteItem",
    },
    async (_actorId, actionData: FormData) => {
      const parsed = addItemSchema.safeParse(Object.fromEntries(actionData.entries()));
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Stavka nije ispravna.",
        };
      }
      const item = await addStocktakeDispatchItem(parsed.data);
      revalidateStocktake(parsed.data.dispatchId);
      return {
        ok: true as const,
        entityId: item.id,
        diff: { dispatchId: parsed.data.dispatchId, sku: item.sku, qty: item.qty },
        message: `Artikal ${item.sku} je dodat.`,
      };
    },
  )(formData);
}

async function updateItemAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "stocktake-dispatch.item.update",
      entity: "DispatchNoteItem",
    },
    async (_actorId, actionData: FormData) => {
      const parsed = itemSchema.safeParse(Object.fromEntries(actionData.entries()));
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Količina nije ispravna.",
        };
      }
      await updateStocktakeDispatchItem(parsed.data);
      revalidateStocktake(parsed.data.dispatchId);
      return {
        ok: true as const,
        entityId: parsed.data.itemId,
        diff: { dispatchId: parsed.data.dispatchId, qty: parsed.data.qty },
        message: "Količina je sačuvana.",
      };
    },
  )(formData);
}

async function removeItemAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "stocktake-dispatch.item.remove",
      entity: "DispatchNoteItem",
    },
    async (_actorId, actionData: FormData) => {
      const parsed = removeItemSchema.safeParse(Object.fromEntries(actionData.entries()));
      if (!parsed.success) return { ok: false as const, error: "Stavka nije izabrana." };
      await removeStocktakeDispatchItem(parsed.data);
      revalidateStocktake(parsed.data.dispatchId);
      return {
        ok: true as const,
        entityId: parsed.data.itemId,
        diff: { dispatchId: parsed.data.dispatchId },
        message: "Stavka je uklonjena.",
      };
    },
  )(formData);
}

async function postAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "stocktake-dispatch.post",
      entity: "DispatchNote",
    },
    async (actorId, actionData: FormData) => {
      const parsed = dispatchSchema.safeParse(Object.fromEntries(actionData.entries()));
      if (!parsed.success) return { ok: false as const, error: "Popis nije izabran." };
      const posted = await postStocktakeDispatches([parsed.data.dispatchId], actorId);
      revalidateStocktake(parsed.data.dispatchId);
      return {
        ok: true as const,
        entityId: parsed.data.dispatchId,
        diff: { posted, destinationName: STOCKTAKE_DESTINATION_NAME },
        message: "Popis je proknjižen i stanje magacina je usaglašeno.",
      };
    },
  )(formData);
}

function formatDate(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Belgrade",
  }).format(value);
}

export default async function StocktakeDispatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const { id } = await params;
  const [dispatch, warehouses] = await Promise.all([
    db.dispatchNote.findFirst({
      where: { id, type: DispatchNoteType.STOCKTAKE },
      include: {
        sourceWarehouse: { select: { id: true, name: true } },
        items: {
          orderBy: [{ sku: "asc" }, { id: "asc" }],
          include: {
            product: { select: { id: true, stock: true } },
          },
        },
      },
    }),
    db.warehouse.findMany({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, isDefault: true },
    }),
  ]);
  if (!dispatch) notFound();

  const warehouseStocks = dispatch.items.length
    ? await db.warehouseStock.findMany({
        where: {
          warehouseId: dispatch.sourceWarehouseId,
          productId: {
            in: dispatch.items.flatMap((item) =>
              item.productId ? [item.productId] : [],
            ),
          },
        },
        select: { productId: true, qty: true },
      })
    : [];
  const warehouseQty = new Map(
    warehouseStocks.map((stock) => [stock.productId, stock.qty]),
  );
  const productIds = dispatch.items.flatMap((item) =>
    item.productId ? [item.productId] : [],
  );
  const reservationRows = productIds.length
    ? await db.orderItem.groupBy({
        by: ["productId"],
        where: {
          productId: { in: productIds },
          warehouseReservedQty: { gt: 0 },
          OR: [
            { warehouseId: dispatch.sourceWarehouseId },
            ...(warehouses.find(
              (warehouse) => warehouse.id === dispatch.sourceWarehouseId,
            )?.isDefault
              ? [{ warehouseId: null }]
              : []),
          ],
          order: {
            status: { notIn: ["ISPORUCENO", "OTKAZANO", "VRACENO"] },
          },
        },
        _sum: { warehouseReservedQty: true },
      })
    : [];
  const reservedQty = new Map(
    reservationRows.flatMap((row) =>
      row.productId
        ? [[row.productId, row._sum.warehouseReservedQty ?? 0] as const]
        : [],
    ),
  );
  const editable = isStocktakeDispatchEditable(
    dispatch.status,
    dispatch.archivedAt,
  );
  const totalQty = dispatch.items.reduce((sum, item) => sum + item.qty, 0);

  return (
    <>
      <PageHeader
        title={`Popis ${dispatch.number}`}
        description={`${STOCKTAKE_STATUS_LABEL[dispatch.status]} · ${dispatch.sourceWarehouse.name} → ${STOCKTAKE_DESTINATION_NAME}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { href: "/admin/erp/popisi", label: "Popisi" },
          { label: dispatch.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/erp/popisi"
              className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
            >
              Svi popisi
            </Link>
            <AdminActionForm action={postAction}>
              <input type="hidden" name="dispatchId" value={dispatch.id} />
              <SubmitButton
                disabled={!editable || dispatch.items.length === 0}
                confirm="Proknjižiti popis? Stanje izabranog magacina biće usaglašeno sa prebrojanim količinama."
                pendingLabel="Knjiženje…"
              >
                Proknjiži popis
              </SubmitButton>
            </AdminActionForm>
          </div>
        }
      />

      <div className="space-y-6 px-4 py-6 md:px-8">
        <Card>
          <CardTitle description="Popis usaglašava stanje izabranog magacina sa fizički prebrojanim količinama.">
            Podaci otpremnice
          </CardTitle>
          {dispatch.archivedAt ? (
            <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink-700">
              Dokument je arhiviran {formatDate(dispatch.archivedAt)}. Vratite ga
              iz arhive pre izmene ili knjiženja.
            </p>
          ) : !editable ? (
            <p className="mb-4 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
              Dokument je proknjižen {formatDate(dispatch.postedAt)} i više ga nije moguće menjati.
            </p>
          ) : null}
          <AdminActionForm action={saveHeaderAction}>
            <fieldset
              disabled={!editable}
              className="grid gap-4 md:grid-cols-2"
            >
              <input type="hidden" name="dispatchId" value={dispatch.id} />
              <Field label="Magacin firme koja šalje robu">
                <select
                  name="sourceWarehouseId"
                  required
                  defaultValue={dispatch.sourceWarehouseId}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name} ({warehouse.code})
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Magacin firme koja prima robu"
                hint="Fiksno odredište za sve popisne otpremnice."
              >
                <Input value={STOCKTAKE_DESTINATION_NAME} readOnly disabled />
              </Field>
              <Field label="Napomena" className="md:col-span-2">
                <Textarea
                  name="notes"
                  rows={3}
                  defaultValue={dispatch.notes ?? ""}
                />
              </Field>
              {editable ? (
                <div className="flex justify-end md:col-span-2">
                  <SubmitButton pendingLabel="Čuvanje…">
                    Sačuvaj podatke
                  </SubmitButton>
                </div>
              ) : null}
            </fieldset>
          </AdminActionForm>
        </Card>

        {editable ? (
          <Card>
            <CardTitle description="Unesite šifru artikla i fizički prebrojanu količinu. Nula je dozvoljena.">
              Dodaj stavku
            </CardTitle>
            <AdminActionForm action={addItemAction} className="grid gap-4 md:grid-cols-[1fr_160px_auto] md:items-end">
              <input type="hidden" name="dispatchId" value={dispatch.id} />
              <Field label="Šifra artikla">
                <Input name="sku" required autoComplete="off" />
              </Field>
              <Field label="Prebrojano">
                <Input name="qty" type="number" min={0} step={1} required defaultValue={0} />
              </Field>
              <SubmitButton pendingLabel="Dodavanje…">Dodaj stavku</SubmitButton>
            </AdminActionForm>
          </Card>
        ) : null}

        <Card>
          <CardTitle description={`Stavke: ${dispatch.items.length} · ukupna količina: ${totalQty}`}>
            Stavke popisa
          </CardTitle>
          {dispatch.items.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-[760px] text-sm">
                <thead className="bg-muted-bg/70 text-left text-xs uppercase tracking-[0.08em] text-ink-500">
                  <tr>
                    <th className="px-3 py-3">Šifra</th>
                    <th className="px-3 py-3">Naziv</th>
                    <th className="px-3 py-3 text-right">Očekivano</th>
                    <th className="px-3 py-3 text-right">Prebrojano</th>
                    <th className="px-3 py-3 text-right">Razlika</th>
                    {editable ? <th className="px-3 py-3 text-right">Akcije</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {dispatch.items.map((item) => {
                    const available = item.productId
                      ? (warehouseQty.get(item.productId) ?? item.product?.stock ?? 0)
                      : 0;
                    const expected =
                      available +
                      (item.productId ? (reservedQty.get(item.productId) ?? 0) : 0);
                    const difference = item.qty - expected;
                    return (
                      <tr key={item.id}>
                        <td className="px-3 py-3 font-medium">{item.sku}</td>
                        <td className="px-3 py-3">{item.name}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{expected}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {editable ? (
                            <AdminActionForm action={updateItemAction} className="ml-auto flex w-fit items-center gap-2">
                              <input type="hidden" name="dispatchId" value={dispatch.id} />
                              <input type="hidden" name="itemId" value={item.id} />
                              <Input
                                aria-label={`Količina za ${item.sku}`}
                                name="qty"
                                type="number"
                                min={0}
                                step={1}
                                required
                                defaultValue={item.qty}
                                className="w-24 text-right"
                              />
                              <SubmitButton
                                variant="outline"
                                pendingLabel="…"
                                aria-label={`Sačuvaj ${item.sku}`}
                              >
                                Sačuvaj
                              </SubmitButton>
                            </AdminActionForm>
                          ) : (
                            item.qty
                          )}
                        </td>
                        <td
                          className={`px-3 py-3 text-right tabular-nums ${
                            difference === 0
                              ? "text-ink-500"
                              : difference > 0
                                ? "text-success"
                                : "text-warning"
                          }`}
                        >
                          {difference > 0 ? `+${difference}` : difference}
                        </td>
                        {editable ? (
                          <td className="px-3 py-3 text-right">
                            <AdminActionForm action={removeItemAction} className="inline-flex">
                              <input type="hidden" name="dispatchId" value={dispatch.id} />
                              <input type="hidden" name="itemId" value={item.id} />
                              <SubmitButton
                                variant="destructive"
                                confirm={`Ukloniti artikal ${item.sku} iz popisa?`}
                                pendingLabel="Uklanjanje…"
                                aria-label={`Ukloni ${item.sku}`}
                              >
                                Ukloni
                              </SubmitButton>
                            </AdminActionForm>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-ink-500">
              Popis nema stavke. Dodajte bar jedan artikal pre knjiženja.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
