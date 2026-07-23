import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ErpCurrency, PurchaseOrderStatus } from "@prisma/client";
import { z } from "zod";
import { AdminActionForm } from "@/components/admin/action-form";
import { Card, CardTitle } from "@/components/admin/card";
import { ConfirmSubmitButton } from "@/components/admin/confirm-submit";
import { Field } from "@/components/admin/field";
import { PageHeader } from "@/components/admin/page-header";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addPurchaseOrderItem,
  changePurchaseOrderStatus,
  postPurchaseOrder,
  receivePurchaseOrder,
  recomputePurchaseOrderTotals,
  sendPurchaseOrder,
  updatePurchaseOrderItem,
} from "@/lib/admin/po";
import type { AdminActionState } from "@/lib/admin/action-state";
import { withAdmin, withAdminState, requireAdminAction } from "@/lib/admin";
import {
  calculateDeliveryDate,
  isPackQuantityValid,
  purchaseOrderCapacityWarnings,
} from "@/lib/admin/purchase-order";
import { db } from "@/lib/db";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Porudžbenica · ERP",
  robots: { index: false, follow: false },
};

const statusLabel: Record<PurchaseOrderStatus, string> = {
  DRAFT: "U obradi",
  SENT: "Poslata",
  CONFIRMED: "Potvrđena",
  RECEIVED: "Primljena",
  CANCELLED: "Otkazana",
};

const currencyOptions: ErpCurrency[] = ["RSD", "EUR", "USD"];

function num(value: unknown) {
  return value == null ? null : Number(value);
}

function fmt(value: number | null, digits = 2) {
  if (value == null) return "—";
  return new Intl.NumberFormat("sr-Latn-RS", {
    maximumFractionDigits: digits,
    minimumFractionDigits: value % 1 ? Math.min(digits, 2) : 0,
  }).format(value);
}

function dtLocal(value?: Date | null) {
  return value?.toISOString().slice(0, 10) ?? "";
}

function parseOptionalNumber(formData: FormData, key: string) {
  const raw = String(formData.get(key) ?? "").trim().replace(",", ".");
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} mora biti broj.`);
  return value;
}

const headerSchema = z.object({
  poId: z.string().min(1),
  supplierId: z.string().min(1, "Izaberite dobavljača."),
  loadingLocationId: z.string().min(1, "Izaberite mesto utovara."),
  receivingWarehouseId: z.string().min(1, "Izaberite magacin za prijem."),
  transportTypeId: z.string().min(1, "Izaberite tip transporta."),
  orderDate: z.iso.date(),
  loadingDate: z.union([z.iso.date(), z.literal("")]),
  exchangeRate: z.coerce.number().positive().max(1_000_000),
  freightCost: z.coerce.number().nonnegative().max(100_000_000),
  freightCurrency: z.nativeEnum(ErpCurrency),
  freightExchangeRate: z.coerce.number().positive().max(1_000_000),
  notes: z.string().max(2000),
});

async function saveHeader(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "po.header.save", entity: "PurchaseOrder" },
    async (_actorId, actionData: FormData) => {
      const parsed = headerSchema.safeParse(Object.fromEntries(actionData.entries()));
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Neispravan unos.",
        };
      }
      const data = parsed.data;
      const current = await db.purchaseOrder.findUnique({
        where: { id: data.poId },
        select: {
          lockedAt: true,
          status: true,
          orderDate: true,
          items: {
            select: {
              product: { select: { supplierId: true } },
            },
          },
        },
      });
      if (!current) return { ok: false as const, error: "Porudžbenica ne postoji." };
      if (current.lockedAt) {
        return {
          ok: false as const,
          error: "Proknjižena porudžbenica je zaključana za izmene.",
        };
      }
      const [supplier, loadingLocation, warehouse, transport] = await Promise.all([
        db.supplier.findUnique({ where: { id: data.supplierId } }),
        db.supplierLoadingLocation.findUnique({
          where: { id: data.loadingLocationId },
        }),
        db.warehouse.findUnique({ where: { id: data.receivingWarehouseId } }),
        db.transportType.findUnique({ where: { id: data.transportTypeId } }),
      ]);
      if (!supplier?.enabled) {
        return { ok: false as const, error: "Izabrani dobavljač nije aktivan." };
      }
      if (!loadingLocation || loadingLocation.supplierId !== supplier.id) {
        return {
          ok: false as const,
          error: "Mesto utovara ne pripada izabranom dobavljaču.",
        };
      }
      if (!warehouse?.active) {
        return { ok: false as const, error: "Izabrani magacin nije aktivan." };
      }
      if (!transport?.active) {
        return { ok: false as const, error: "Izabrani tip transporta nije aktivan." };
      }
      if (
        current.items.some(
          (item) =>
            item.product?.supplierId &&
            item.product.supplierId !== supplier.id,
        )
      ) {
        return {
          ok: false as const,
          error:
            "Dobavljač ne može da se promeni jer porudžbenica sadrži artikle drugog dobavljača.",
        };
      }
      const requestedOrderDate = new Date(`${data.orderDate}T00:00:00.000Z`);
      const orderDate =
        current.status === PurchaseOrderStatus.DRAFT
          ? requestedOrderDate
          : current.orderDate ?? requestedOrderDate;
      const loadingDate = data.loadingDate
        ? new Date(`${data.loadingDate}T00:00:00.000Z`)
        : null;
      const exchangeRate =
        supplier.currency === ErpCurrency.RSD ? 1 : data.exchangeRate;
      const freightExchangeRate =
        data.freightCurrency === ErpCurrency.RSD ? 1 : data.freightExchangeRate;
      await db.purchaseOrder.update({
        where: { id: data.poId },
        data: {
          supplierId: supplier.id,
          loadingLocationId: loadingLocation.id,
          receivingWarehouseId: warehouse.id,
          transportTypeId: transport.id,
          transportType: transport.name,
          orderDate,
          loadingDate,
          deliveryDate: calculateDeliveryDate({
            orderDate,
            loadingDate,
            deliveryDays: supplier.deliveryDays,
            transitDays: supplier.transitDays,
          }),
          currency: supplier.currency,
          exchangeRate,
          parity: supplier.parity,
          freightCost: data.freightCost,
          freightCurrency: data.freightCurrency,
          freightExchangeRate,
          notes: data.notes || null,
        },
      });
      await recomputePurchaseOrderTotals(data.poId);
      revalidatePath(`/admin/erp/porudzbenice/${data.poId}`);
      revalidatePath("/admin/erp/porudzbenice");
      revalidatePath("/admin/erp/porudzbenice-po-artiklima");
      return { ok: true as const, entityId: data.poId };
    },
  )(formData);
}

const addLineSchema = z.object({
  poId: z.string().min(1),
  sku: z.string().trim().min(1),
  qty: z.coerce.number().int().positive(),
});

async function addLine(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "po.line.add", entity: "PurchaseOrderItem" },
    async (_actorId, actionData: FormData) => {
      const parsed = addLineSchema.safeParse(Object.fromEntries(actionData.entries()));
      if (!parsed.success) {
        return {
          ok: false as const,
          error: "Unesite šifru i količinu (ceo broj veći od 0).",
        };
      }
      const item = await addPurchaseOrderItem({
        purchaseOrderId: parsed.data.poId,
        sku: parsed.data.sku,
        qty: parsed.data.qty,
      });
      revalidatePath(`/admin/erp/porudzbenice/${parsed.data.poId}`);
      revalidatePath("/admin/erp/porudzbenice");
      revalidatePath("/admin/erp/porudzbenice-po-artiklima");
      return { ok: true as const, entityId: item.id };
    },
  )(formData);
}

async function updateLine(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "po.line.update", entity: "PurchaseOrderItem" },
    async (_actorId, actionData: FormData) => {
      const id = String(actionData.get("id") ?? "");
      const poId = String(actionData.get("poId") ?? "");
      const qty = Number(actionData.get("qty"));
      const purchasePrice = Number(
        String(actionData.get("purchasePrice") ?? "").replace(",", "."),
      );
      const customsRate = parseOptionalNumber(actionData, "customsRate");
      const calcRetailPrice = parseOptionalNumber(actionData, "calcRetailPrice");
      await updatePurchaseOrderItem({
        id,
        qty,
        purchasePrice,
        customsRate,
        calcRetailPrice,
      });
      revalidatePath(`/admin/erp/porudzbenice/${poId}`);
      revalidatePath("/admin/erp/porudzbenice");
      revalidatePath("/admin/erp/porudzbenice-po-artiklima");
      return { ok: true as const, entityId: id };
    },
  )(formData);
}

async function deleteLine(formData: FormData) {
  "use server";
  return withAdmin(
    { allowed: ["OPS"], action: "po.line.delete", entity: "PurchaseOrderItem" },
    async (_actorId, actionData: FormData) => {
      const id = String(actionData.get("id") ?? "");
      const item = await db.purchaseOrderItem.findUnique({
        where: { id },
        include: { purchaseOrder: { select: { lockedAt: true } } },
      });
      if (!item) return { ok: false as const, error: "Stavka ne postoji." };
      if (item.purchaseOrder.lockedAt) {
        return {
          ok: false as const,
          error: "Stavka proknjižene porudžbenice ne može da se obriše.",
        };
      }
      await db.purchaseOrderItem.delete({ where: { id } });
      await recomputePurchaseOrderTotals(item.purchaseOrderId);
      revalidatePath(`/admin/erp/porudzbenice/${item.purchaseOrderId}`);
      revalidatePath("/admin/erp/porudzbenice");
      revalidatePath("/admin/erp/porudzbenice-po-artiklima");
      return { ok: true as const, entityId: id };
    },
  )(formData);
}

async function statusAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "po.status", entity: "PurchaseOrder" },
    async (actorId, actionData: FormData) => {
      const id = String(actionData.get("poId") ?? "");
      const parsed = z.nativeEnum(PurchaseOrderStatus).safeParse(
        actionData.get("status"),
      );
      if (!id || !parsed.success) {
        return { ok: false as const, error: "Neispravan status." };
      }
      await changePurchaseOrderStatus(id, parsed.data, actorId);
      revalidatePath(`/admin/erp/porudzbenice/${id}`);
      revalidatePath("/admin/erp/porudzbenice");
      return { ok: true as const, entityId: id };
    },
  )(formData);
}

async function postAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "po.post", entity: "PurchaseOrder" },
    async (actorId, actionData: FormData) => {
      const id = String(actionData.get("poId") ?? "");
      await postPurchaseOrder(id, actorId);
      revalidatePath(`/admin/erp/porudzbenice/${id}`);
      revalidatePath("/admin/erp/porudzbenice");
      return { ok: true as const, entityId: id };
    },
  )(formData);
}

async function sendAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "po.send", entity: "PurchaseOrder" },
    async (actorId, actionData: FormData) => {
      const id = String(actionData.get("poId") ?? "");
      await sendPurchaseOrder(id, actorId);
      revalidatePath(`/admin/erp/porudzbenice/${id}`);
      revalidatePath("/admin/erp/porudzbenice");
      return { ok: true as const, entityId: id };
    },
  )(formData);
}

async function receiveAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "po.receive", entity: "PurchaseOrder" },
    async (actorId, actionData: FormData) => {
      const id = String(actionData.get("poId") ?? "");
      await receivePurchaseOrder(id, actorId);
      revalidatePath(`/admin/erp/porudzbenice/${id}`);
      revalidatePath("/admin/erp/porudzbenice");
      return { ok: true as const, entityId: id };
    },
  )(formData);
}

export default async function PurchaseOrderEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const { id } = await params;
  const [order, suppliers, warehouses, transports, products] = await Promise.all([
    db.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: { include: { loadingLocations: { orderBy: { position: "asc" } } } },
        loadingLocation: true,
        receivingWarehouse: true,
        transportDefinition: true,
        items: {
          orderBy: { createdAt: "asc" },
          include: {
            product: {
              select: {
                id: true,
                media: {
                  take: 1,
                  orderBy: { order: "asc" },
                  select: { url: true },
                },
              },
            },
          },
        },
        events: { orderBy: { createdAt: "desc" }, take: 20 },
        inboundInvoices: {
          orderBy: { createdAt: "desc" },
          select: { id: true, number: true, type: true, status: true },
        },
      },
    }),
    db.supplier.findMany({
      where: { enabled: true },
      orderBy: { name: "asc" },
      include: { loadingLocations: { orderBy: { position: "asc" } } },
    }),
    db.warehouse.findMany({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    db.transportType.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
    db.product.findMany({
      where: { deletedAt: null },
      orderBy: { sku: "asc" },
      take: 5000,
      select: { sku: true, name: true, supplierId: true },
    }),
  ]);
  if (!order) notFound();

  const locked = Boolean(order.lockedAt);
  const capacityWarnings = purchaseOrderCapacityWarnings({
    totalVolumeM3: Number(order.totalVolume ?? 0),
    totalWeightKg: Number(order.totalWeight ?? 0),
    payloadM3:
      order.transportDefinition?.payloadM3 == null
        ? null
        : Number(order.transportDefinition.payloadM3),
    payloadKg:
      order.transportDefinition?.payloadKg == null
        ? null
        : Number(order.transportDefinition.payloadKg),
  });
  const relevantProducts = products.filter(
    (product) => !order.supplierId || product.supplierId === order.supplierId,
  );

  return (
    <>
      <PageHeader
        title={`Porudžbenica ${order.number}`}
        description={`Status: ${statusLabel[order.status]}${order.supplier ? ` · ${order.supplier.name}` : ""}${locked ? " · Proknjižena" : ""}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { href: "/admin/erp/porudzbenice", label: "Porudžbenice" },
          { label: order.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/api/admin/purchase-orders/${order.id}/pdf`}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
            >
              Štampa PDF
            </Link>
            <a
              href={`/api/admin/purchase-orders/${order.id}/excel`}
              download={`porudzbenica-${order.number.replaceAll("/", "-")}.xlsx`}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
            >
              Štampa Excel
            </a>
            <Link
              href="#vezani-dokumenti"
              className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
            >
              Vezani dokumenti
            </Link>
            {!locked ? (
              <AdminActionForm action={postAction}>
                <input type="hidden" name="poId" value={order.id} />
                <SubmitButton
                  variant="outline"
                  confirm="Proknjižiti i zaključati porudžbenicu?"
                  pendingLabel="Knjiženje…"
                >
                  Proknjiži porudžbenicu
                </SubmitButton>
              </AdminActionForm>
            ) : null}
            <AdminActionForm action={sendAction}>
              <input type="hidden" name="poId" value={order.id} />
              <SubmitButton
                variant="outline"
                pendingLabel="Slanje…"
                disabled={
                  order.status === PurchaseOrderStatus.RECEIVED ||
                  order.status === PurchaseOrderStatus.CANCELLED
                }
              >
                Pošalji dobavljaču
              </SubmitButton>
            </AdminActionForm>
            {locked &&
            order.status !== PurchaseOrderStatus.RECEIVED &&
            order.status !== PurchaseOrderStatus.CANCELLED ? (
              <AdminActionForm action={receiveAction}>
                <input type="hidden" name="poId" value={order.id} />
                <SubmitButton
                  confirm="Primiti celu porudžbenicu u izabrani magacin i ažurirati COGS?"
                  pendingLabel="Prijem…"
                >
                  Primi u magacin
                </SubmitButton>
              </AdminActionForm>
            ) : null}
          </div>
        }
      />

      <div className="space-y-6 px-4 py-6 md:px-8">
        {capacityWarnings.length ? (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
            <p className="font-semibold">Kapacitet transporta je prekoračen:</p>
            <ul className="mt-1 list-disc pl-5">
              {capacityWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(620px,0.9fr)_minmax(0,1.1fr)]">
          <Card>
            <CardTitle description="Dobavljački podaci, rokovi, transport, valute i magacin za prijem.">
              Zaglavlje
            </CardTitle>
            {locked ? (
              <p className="mb-4 rounded-lg border border-border/60 bg-muted-bg/40 px-3 py-2 text-sm text-ink-600">
                Dokument je proknjižen {order.lockedAt ? dtLocal(order.lockedAt) : ""} i poslovni podaci su zaključani.
              </p>
            ) : null}
            <AdminActionForm action={saveHeader}>
              <fieldset
                key={order.updatedAt.toISOString()}
                disabled={locked}
                className="grid gap-4 md:grid-cols-2"
              >
                <input type="hidden" name="poId" value={order.id} />
                <Field label="Broj porudžbenice">
                  <Input value={order.number} readOnly />
                </Field>
                <Field label="Dobavljač">
                  <select
                    name="supplierId"
                    required
                    defaultValue={order.supplierId ?? ""}
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="">— izaberite —</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Uslovi plaćanja">
                  <Input value={order.supplier?.paymentTerms ?? ""} readOnly placeholder="Iz baze dobavljača" />
                </Field>
                <Field label="Mesto utovara">
                  <select
                    name="loadingLocationId"
                    required
                    defaultValue={order.loadingLocationId ?? ""}
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="">— izaberite —</option>
                    {suppliers.flatMap((supplier) =>
                      supplier.loadingLocations.map((location) => (
                        <option
                          key={location.id}
                          value={location.id}
                        >
                          {supplier.name} · {location.position}. {location.name}
                        </option>
                      )),
                    )}
                  </select>
                </Field>
                <Field label="Datum porudžbenice" hint="Ponovno slanje dobavljaču postavlja datum na današnji.">
                  <Input
                    name="orderDate"
                    type="date"
                    required
                    readOnly={order.status !== PurchaseOrderStatus.DRAFT}
                    defaultValue={dtLocal(order.orderDate ?? order.createdAt)}
                  />
                </Field>
                <Field label="Datum utovara">
                  <Input name="loadingDate" type="date" defaultValue={dtLocal(order.loadingDate)} />
                </Field>
                <Field label="Datum isporuke" hint="Automatski: datum utovara + tranzit, odnosno datum porudžbine + rok isporuke.">
                  <Input value={dtLocal(order.deliveryDate)} readOnly />
                </Field>
                <Field label="Magacin za prijem">
                  <select
                    name="receivingWarehouseId"
                    required
                    defaultValue={order.receivingWarehouseId ?? ""}
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="">— izaberite —</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name} ({warehouse.code}){warehouse.isDefault ? " · podrazumevani" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Tip transporta">
                  <select
                    name="transportTypeId"
                    required
                    defaultValue={order.transportTypeId ?? ""}
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="">— izaberite —</option>
                    {transports.map((transport) => (
                      <option key={transport.id} value={transport.id}>
                        {transport.name} · {fmt(num(transport.payloadKg), 3)} kg · {fmt(num(transport.payloadM3), 3)} m³
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Paritet">
                  <Input value={order.supplier?.parity ?? order.parity ?? ""} readOnly placeholder="Iz baze dobavljača" />
                </Field>
                <Field label="Valuta">
                  <Input value={order.supplier?.currency ?? order.currency} readOnly />
                </Field>
                <Field
                  label="Kurs nabavne valute"
                  hint={(order.supplier?.currency ?? order.currency) === ErpCurrency.RSD ? "Za RSD je kurs 1." : "Obavezan kurs prema RSD."}
                >
                  <Input
                    name="exchangeRate"
                    type="number"
                    min="0.000001"
                    step="0.000001"
                    required
                    defaultValue={(order.supplier?.currency ?? order.currency) === ErpCurrency.RSD ? 1 : num(order.exchangeRate) ?? 1}
                  />
                </Field>
                <Field label="Kalkulativna cena prevoza">
                  <Input
                    name="freightCost"
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    defaultValue={num(order.freightCost) ?? 0}
                  />
                </Field>
                <Field label="Valuta cene prevoza">
                  <select
                    name="freightCurrency"
                    defaultValue={order.freightCurrency}
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  >
                    {currencyOptions.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Kurs valute prevoza" hint="Za RSD unesite 1.">
                  <Input
                    name="freightExchangeRate"
                    type="number"
                    min="0.000001"
                    step="0.000001"
                    required
                    defaultValue={num(order.freightExchangeRate) ?? 1}
                  />
                </Field>
                <Field label="Napomena" className="md:col-span-2">
                  <Textarea name="notes" rows={3} defaultValue={order.notes ?? ""} />
                </Field>
                {!locked ? (
                  <div className="flex justify-end md:col-span-2">
                    <SubmitButton>Sačuvaj zaglavlje</SubmitButton>
                  </div>
                ) : null}
              </fieldset>
            </AdminActionForm>

            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/60 pt-4 text-sm">
              <dt className="text-ink-500">Ukupna zapremina</dt>
              <dd className="text-right tabular-nums">{fmt(num(order.totalVolume), 3)} m³</dd>
              <dt className="text-ink-500">Ukupna težina</dt>
              <dd className="text-right tabular-nums">{fmt(num(order.totalWeight), 3)} kg</dd>
              <dt className="text-ink-500">Ukupna cena</dt>
              <dd className="text-right tabular-nums">{fmt(num(order.totalPrice))} {order.currency}</dd>
              <dt className="text-ink-500">Transport</dt>
              <dd className="text-right tabular-nums">{fmt(num(order.freightCost))} {order.freightCurrency}</dd>
              <dt className="text-ink-500">Ukupna BM%</dt>
              <dd className="text-right tabular-nums">{fmt(num(order.bmPct))}%</dd>
            </dl>

            <AdminActionForm action={statusAction} className="mt-5 border-t border-border/60 pt-4">
              <input type="hidden" name="poId" value={order.id} />
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Ručna promena statusa" className="min-w-52">
                  <select
                    key={order.status}
                    name="status"
                    defaultValue={order.status}
                    className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                  >
                    {order.status === PurchaseOrderStatus.DRAFT ? (
                      <option value={PurchaseOrderStatus.DRAFT}>U obradi</option>
                    ) : null}
                    <option value={PurchaseOrderStatus.CONFIRMED}>Potvrđena</option>
                    <option value={PurchaseOrderStatus.CANCELLED}>Otkazana</option>
                    {order.status === PurchaseOrderStatus.SENT ? <option value={PurchaseOrderStatus.SENT}>Poslata</option> : null}
                    {order.status === PurchaseOrderStatus.RECEIVED ? <option value={PurchaseOrderStatus.RECEIVED}>Primljena</option> : null}
                  </select>
                </Field>
                <SubmitButton variant="outline">Promeni status</SubmitButton>
              </div>
            </AdminActionForm>
          </Card>

          <Card className="min-w-0 p-0">
            <div className="border-b border-border/60 px-5 py-4">
              <h2 className="text-base font-semibold text-ink-900">Artikli porudžbenice</h2>
              <p className="text-sm text-ink-500">
                Šifra povlači važeću cenu i matične podatke. Nabavna cena, količina, carina i kalkulativna MPC mogu da se koriguju do knjiženja.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[1900px] text-sm">
                <thead className="bg-muted-bg/70 text-left text-xs uppercase tracking-[0.08em] text-ink-500">
                  <tr>
                    {["Foto", "Šifra", "Dobavljač / naziv", "Atributi / dezen", "Nabavna cena", "Valuta / paritet / važi od", "MOQ / kom-pak", "Količina", "Zapremina / težina", "Carina %", "Kalk. MPC", "BM%", "Dobavljačev naziv / sertifikati / bar-kod", ""].map((label) => (
                      <th key={label} className="whitespace-nowrap px-3 py-3">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {order.items.map((item) => {
                    const invalidPack = !isPackQuantityValid(item.qty, item.packQty);
                    const photo = item.product?.media[0]?.url
                      ? resolveSupabaseStorageUrl(item.product.media[0].url)
                      : null;
                    return (
                      <tr key={item.id} className={invalidPack ? "bg-danger/10" : "hover:bg-muted-bg/30"}>
                        <td className="px-3 py-2">
                          {photo ? (
                            <Link href={`/admin/proizvodi/${item.productId}#mediji`}>
                              <Image src={photo} alt="" width={48} height={48} className="size-12 rounded-md object-cover" />
                            </Link>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2 font-medium">{item.sku}</td>
                        <td className="px-3 py-2">
                          <p>{order.supplier?.name ?? "—"}</p>
                          <p className="text-ink-500">{item.name}</p>
                        </td>
                        <td className="max-w-60 px-3 py-2 text-xs">
                          <p>{item.attributes ?? "—"}</p>
                          <p className="text-ink-500">{item.pattern ?? "—"}</p>
                        </td>
                        <td colSpan={8} className="p-0">
                          {locked ? (
                            <div className="grid grid-cols-[150px_190px_120px_120px_170px_120px_120px_110px] items-center">
                              <span className="px-3 py-2 text-right tabular-nums">{fmt(num(item.purchasePrice))}</span>
                              <span className="px-3 py-2">{item.currency} · {item.parity ?? "—"} · {dtLocal(item.priceValidFrom)}</span>
                              <span className="px-3 py-2">{item.moq ?? "—"} / {item.packQty ?? "—"}</span>
                              <span className="px-3 py-2 text-right">{item.qty}</span>
                              <span className="px-3 py-2 text-right">{fmt(num(item.totalVolume), 3)} m³ / {fmt(num(item.totalWeight), 3)} kg</span>
                              <span className="px-3 py-2 text-right">{fmt(num(item.customsRate))}</span>
                              <span className="px-3 py-2 text-right">{fmt(num(item.calcRetailPrice))}</span>
                              <span className="px-3 py-2 text-right">{fmt(num(item.bmPct))}%</span>
                            </div>
                          ) : (
                            <AdminActionForm action={updateLine}>
                              <input type="hidden" name="id" value={item.id} />
                              <input type="hidden" name="poId" value={order.id} />
                              <div className="grid grid-cols-[150px_190px_120px_120px_170px_120px_120px_110px] items-center">
                                <div className="px-2 py-2"><Input aria-label={`Nabavna cena ${item.sku}`} name="purchasePrice" type="number" min={0} step="0.01" defaultValue={num(item.purchasePrice) ?? 0} /></div>
                                <span className="px-3 py-2">{item.currency} · {item.parity ?? "—"} · {dtLocal(item.priceValidFrom)}</span>
                                <span className="px-3 py-2">{item.moq ?? "—"} / {item.packQty ?? "—"}</span>
                                <div className="px-2 py-2">
                                  <Input
                                    aria-label={`Količina ${item.sku}`}
                                    name="qty"
                                    type="number"
                                    min={1}
                                    step={1}
                                    defaultValue={item.qty}
                                    className={invalidPack ? "border-danger text-danger" : ""}
                                  />
                                  {invalidPack ? <span className="mt-1 block text-[10px] text-danger">Nije deljivo sa {item.packQty}</span> : null}
                                </div>
                                <span className="px-3 py-2 text-right">{fmt(num(item.totalVolume), 3)} m³ / {fmt(num(item.totalWeight), 3)} kg</span>
                                <div className="px-2 py-2"><Input aria-label={`Carinska stopa ${item.sku}`} name="customsRate" type="number" min={0} max={100} step="0.01" defaultValue={num(item.customsRate) ?? ""} /></div>
                                <div className="px-2 py-2"><Input aria-label={`Kalkulativna MPC ${item.sku}`} name="calcRetailPrice" type="number" min={0} step="0.01" defaultValue={num(item.calcRetailPrice) ?? ""} /></div>
                                <div className="flex items-center justify-end gap-2 px-2 py-2">
                                  <span>{fmt(num(item.bmPct))}%</span>
                                  <SubmitButton size="xs" variant="outline" pendingLabel="…">Snimi</SubmitButton>
                                </div>
                              </div>
                            </AdminActionForm>
                          )}
                        </td>
                        <td className="max-w-64 px-3 py-2 text-xs">
                          <p>{item.supplierProductName ?? "—"}</p>
                          <p className="text-ink-500">{item.certificates ?? "—"}</p>
                          <p className="font-mono text-ink-500">{item.barcode ?? "—"}</p>
                        </td>
                        <td className="px-3 py-2">
                          {!locked ? (
                            <form action={deleteLine}>
                              <input type="hidden" name="id" value={item.id} />
                              <ConfirmSubmitButton size="xs" confirm="Obrisati stavku?" pendingLabel="…">
                                Obriši
                              </ConfirmSubmitButton>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {!order.items.length ? (
                    <tr><td colSpan={14} className="px-4 py-10 text-center text-ink-500">Još nema stavki.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {!locked ? (
              <div className="border-t border-border/60 p-5">
                <Card className="bg-muted-bg/30">
                  <CardTitle>Dodaj stavku</CardTitle>
                  <AdminActionForm action={addLine} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="poId" value={order.id} />
                    <Field label="Šifra artikla" className="w-64">
                      <Input name="sku" required list="purchase-order-products" placeholder="Unesite šifru" />
                      <datalist id="purchase-order-products">
                        {relevantProducts.map((product) => (
                          <option key={product.sku} value={product.sku}>{product.name}</option>
                        ))}
                      </datalist>
                    </Field>
                    <Field label="Količina" className="w-32">
                      <Input name="qty" type="number" min={1} step={1} defaultValue={1} required />
                    </Field>
                    <SubmitButton>Dodaj</SubmitButton>
                  </AdminActionForm>
                </Card>
              </div>
            ) : null}
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card id="vezani-dokumenti">
            <CardTitle description="Ulazne fakture povezane sa ovom porudžbenicom.">Vezani dokumenti</CardTitle>
            {order.inboundInvoices.length ? (
              <ul className="space-y-2 text-sm">
                {order.inboundInvoices.map((invoice) => (
                  <li key={invoice.id} className="flex items-center justify-between gap-3">
                    <span>{invoice.number} · {invoice.type} · {invoice.status}</span>
                    <Link
                      href="/admin/erp/ulazne-fakture"
                      className="text-walnut hover:underline"
                    >
                      Otvori pregled
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-500">Nema vezanih dokumenata.</p>}
          </Card>
          <Card>
            <CardTitle>Istorija statusa</CardTitle>
            {order.events.length ? (
              <ul className="space-y-2 text-sm">
                {order.events.map((event) => (
                  <li key={event.id} className="flex items-center justify-between gap-3">
                    <span className="text-ink-700">{statusLabel[event.status]}{event.note ? ` — ${event.note}` : ""}</span>
                    <span className="shrink-0 text-xs text-ink-400">
                      {new Intl.DateTimeFormat("sr-Latn-RS", { dateStyle: "short", timeStyle: "short" }).format(event.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-500">Još nema promena statusa.</p>}
          </Card>
        </div>

        <div>
          <Link href="/admin/erp/porudzbenice" className="text-sm text-walnut hover:underline">
            ← Nazad na pregled porudžbenica
          </Link>
        </div>
      </div>
    </>
  );
}
