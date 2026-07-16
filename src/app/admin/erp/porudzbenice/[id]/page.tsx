import { notFound } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ErpCurrency, PurchaseOrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { withAdmin, withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import {
  recomputePurchaseOrderTotals,
  receivePurchaseOrder,
  sendPurchaseOrder,
} from "@/lib/admin/po";
import { AdminActionForm } from "@/components/admin/action-form";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/admin/submit-button";
import { ConfirmSubmitButton } from "@/components/admin/confirm-submit";
import { DataTable } from "@/components/admin/data-table";

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
  return new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: digits }).format(value);
}

function dtLocal(value?: Date | null) {
  if (!value) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

const headerSchema = z.object({
  poId: z.string().min(1),
  supplierId: z.string().optional().nullable(),
  orderDate: z.string().optional().nullable(),
  loadingDate: z.string().optional().nullable(),
  deliveryDate: z.string().optional().nullable(),
  transportType: z.string().max(120).optional().nullable(),
  parity: z.string().max(60).optional().nullable(),
  currency: z.nativeEnum(ErpCurrency).default(ErpCurrency.RSD),
  freightCost: z.coerce.number().nonnegative().max(100_000_000),
  notes: z.string().max(2000).optional().nullable(),
});

async function saveHeader(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "po.header.save", entity: "PurchaseOrder" },
    async (_actorId, formData: FormData) => {
      const parsed = headerSchema.safeParse(Object.fromEntries(formData.entries()));
      if (!parsed.success) {
        return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Neispravan unos." };
      }
      const d = parsed.data;
      await db.purchaseOrder.update({
        where: { id: d.poId },
        data: {
          supplierId: d.supplierId || null,
          orderDate: d.orderDate ? new Date(d.orderDate) : null,
          loadingDate: d.loadingDate ? new Date(d.loadingDate) : null,
          deliveryDate: d.deliveryDate ? new Date(d.deliveryDate) : null,
          transportType: d.transportType || null,
          parity: d.parity || null,
          currency: d.currency,
          freightCost: d.freightCost,
          notes: d.notes || null,
        },
      });
      revalidatePath(`/admin/erp/porudzbenice/${d.poId}`);
      return { ok: true as const, entityId: d.poId };
    },
  )(formData);
}

const addLineSchema = z.object({
  poId: z.string().min(1),
  sku: z.string().min(1),
  qty: z.coerce.number().int().positive(),
});

async function addLine(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "po.line.add", entity: "PurchaseOrderItem" },
    async (_actorId, formData: FormData) => {
      const parsed = addLineSchema.safeParse(Object.fromEntries(formData.entries()));
      if (!parsed.success) {
        return { ok: false as const, error: "Unesite šifru i količinu (ceo broj > 0)." };
      }
      const { poId, sku, qty } = parsed.data;
      const product = await db.product.findUnique({
        where: { sku },
        select: {
          id: true,
          name: true,
          attribute1: true,
          attribute2: true,
          attribute3: true,
          attribute4: true,
          colorPrimary: true,
          colorSecondary: true,
          widthCm: true,
          depthCm: true,
          heightCm: true,
          fullPrice: true,
          customsRate: true,
          purchasePrices: {
            take: 1,
            orderBy: { validFrom: "desc" },
            select: { price: true, currency: true, parity: true },
          },
        },
      });
      if (!product) {
        return { ok: false as const, error: `Artikal sa šifrom ${sku} ne postoji u bazi artikala.` };
      }

      const latest = product.purchasePrices[0] ?? null;
      const purchasePrice = latest ? Number(latest.price) : Number(product.fullPrice);
      const attributes =
        [product.attribute1, product.attribute2, product.attribute3, product.attribute4]
          .filter(Boolean)
          .join(" / ") || null;
      const pattern =
        [product.colorPrimary, product.colorSecondary].filter(Boolean).join(" + ") || null;
      const w = Number(product.widthCm ?? 0);
      const d = Number(product.depthCm ?? 0);
      const h = Number(product.heightCm ?? 0);
      const perUnitVolume = w && d && h ? (w * d * h) / 1_000_000 : 0;
      const calcRetail = Number(product.fullPrice);
      const customsRate = product.customsRate != null ? Number(product.customsRate) : null;
      const mpcBase = calcRetail / 1.2;
      const customs = purchasePrice * ((customsRate ?? 0) / 100);
      const bm = mpcBase - purchasePrice - customs;
      const bmPct = mpcBase > 0 ? Number(((bm / mpcBase) * 100).toFixed(2)) : null;

      await db.purchaseOrderItem.create({
        data: {
          purchaseOrderId: poId,
          productId: product.id,
          sku,
          name: product.name,
          attributes,
          pattern,
          purchasePrice,
          currency: latest?.currency ?? ErpCurrency.RSD,
          parity: latest?.parity ?? null,
          qty,
          totalVolume: perUnitVolume ? Number((perUnitVolume * qty).toFixed(3)) : null,
          customsRate,
          calcRetailPrice: calcRetail,
          bmPct,
        },
      });
      await recomputePurchaseOrderTotals(poId);
      revalidatePath(`/admin/erp/porudzbenice/${poId}`);
      return { ok: true as const, entityId: poId };
    },
  )(formData);
}

async function updateLineQty(formData: FormData) {
  "use server";
  return withAdmin(
    { allowed: ["OPS"], action: "po.line.qty", entity: "PurchaseOrderItem" },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      const qty = Number(formData.get("qty"));
      if (!id || !Number.isInteger(qty) || qty <= 0) {
        return { ok: false as const, error: "Količina mora biti ceo broj veći od 0." };
      }
      const item = await db.purchaseOrderItem.findUnique({
        where: { id },
        include: { product: { select: { widthCm: true, depthCm: true, heightCm: true } } },
      });
      if (!item) return { ok: false as const, error: "Stavka ne postoji." };
      const w = Number(item.product?.widthCm ?? 0);
      const d = Number(item.product?.depthCm ?? 0);
      const h = Number(item.product?.heightCm ?? 0);
      const perUnitVolume = w && d && h ? (w * d * h) / 1_000_000 : 0;
      await db.purchaseOrderItem.update({
        where: { id },
        data: {
          qty,
          totalVolume: perUnitVolume ? Number((perUnitVolume * qty).toFixed(3)) : item.totalVolume,
        },
      });
      await recomputePurchaseOrderTotals(item.purchaseOrderId);
      revalidatePath(`/admin/erp/porudzbenice/${item.purchaseOrderId}`);
      return { ok: true as const, entityId: id };
    },
  )(formData);
}

async function deleteLine(formData: FormData) {
  "use server";
  return withAdmin(
    { allowed: ["OPS"], action: "po.line.delete", entity: "PurchaseOrderItem" },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      if (!id) return { ok: false as const, error: "Nedostaje ID." };
      const item = await db.purchaseOrderItem.findUnique({ where: { id } });
      if (!item) return { ok: false as const, error: "Stavka ne postoji." };
      await db.purchaseOrderItem.delete({ where: { id } });
      await recomputePurchaseOrderTotals(item.purchaseOrderId);
      revalidatePath(`/admin/erp/porudzbenice/${item.purchaseOrderId}`);
      return { ok: true as const, entityId: id };
    },
  )(formData);
}

async function sendAction(formData: FormData) {
  "use server";
  return withAdmin(
    { allowed: ["OPS"], action: "po.send", entity: "PurchaseOrder" },
    async (actorId, formData: FormData) => {
      const id = String(formData.get("poId") ?? "");
      if (!id) return { ok: false as const, error: "Nedostaje ID." };
      await sendPurchaseOrder(id, actorId);
      revalidatePath(`/admin/erp/porudzbenice/${id}`);
      return { ok: true as const, entityId: id };
    },
  )(formData);
}

async function receiveAction(formData: FormData) {
  "use server";
  return withAdmin(
    { allowed: ["OPS"], action: "po.receive", entity: "PurchaseOrder" },
    async (actorId, formData: FormData) => {
      const id = String(formData.get("poId") ?? "");
      if (!id) return { ok: false as const, error: "Nedostaje ID." };
      await receivePurchaseOrder(id, actorId);
      revalidatePath(`/admin/erp/porudzbenice/${id}`);
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
  const order = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { name: true } },
      items: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!order) notFound();

  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const locked = order.status === PurchaseOrderStatus.RECEIVED;

  return (
    <>
      <PageHeader
        title={`Porudžbenica ${order.number}`}
        description={`Status: ${statusLabel[order.status]}${order.supplier ? ` · ${order.supplier.name}` : ""}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { href: "/admin/erp/porudzbenice", label: "Porudžbenice" },
          { label: order.number },
        ]}
        actions={
          <div className="flex gap-2">
            <Link
              href={`/api/admin/purchase-orders/${order.id}/pdf`}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
            >
              Preuzmi PDF
            </Link>
            <form action={sendAction}>
              <input type="hidden" name="poId" value={order.id} />
              <SubmitButton variant="outline" pendingLabel="…">
                Pošalji dobavljaču
              </SubmitButton>
            </form>
            <form action={receiveAction}>
              <input type="hidden" name="poId" value={order.id} />
              <ConfirmSubmitButton
                variant="default"
                confirm="Proknjižiti prijem? Roba se dodaje na lager i COGS se preračunava."
                pendingLabel="…"
              >
                Kreiraj prijemnicu
              </ConfirmSubmitButton>
            </form>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-[420px_1fr]">
        <Card>
          <CardTitle description="Sumarni podaci porudžbenice.">Zaglavlje</CardTitle>
          <AdminActionForm action={saveHeader}>
            <div key={order.updatedAt.getTime()} className="space-y-4">
              <input type="hidden" name="poId" value={order.id} />
              <Field label="Dobavljač">
                <select
                  name="supplierId"
                  defaultValue={order.supplierId ?? ""}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">— bez dobavljača —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Datum porudžbine">
                  <Input name="orderDate" type="date" defaultValue={dtLocal(order.orderDate)} />
                </Field>
                <Field label="Datum utovara">
                  <Input name="loadingDate" type="date" defaultValue={dtLocal(order.loadingDate)} />
                </Field>
              </div>
              <Field label="Trošak transporta">
                <Input
                  name="freightCost"
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  defaultValue={num(order.freightCost) ?? 0}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Datum isporuke">
                  <Input name="deliveryDate" type="date" defaultValue={dtLocal(order.deliveryDate)} />
                </Field>
                <Field label="Valuta">
                  <select
                    name="currency"
                    defaultValue={order.currency}
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  >
                    {currencyOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tip transporta">
                  <Input name="transportType" defaultValue={order.transportType ?? ""} />
                </Field>
                <Field label="Paritet">
                  <Input name="parity" defaultValue={order.parity ?? ""} />
                </Field>
              </div>
              <Field label="Napomena">
                <Textarea name="notes" rows={2} defaultValue={order.notes ?? ""} />
              </Field>
              <div className="flex justify-end">
                <SubmitButton>Sačuvaj zaglavlje</SubmitButton>
              </div>
            </div>
          </AdminActionForm>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/60 pt-4 text-sm">
            <dt className="text-ink-500">Ukupna zapremina</dt>
            <dd className="text-right tabular-nums">{fmt(num(order.totalVolume), 3)} m³</dd>
            <dt className="text-ink-500">Ukupna težina</dt>
            <dd className="text-right tabular-nums">{fmt(num(order.totalWeight), 3)} kg</dd>
            <dt className="text-ink-500">Ukupna cena</dt>
            <dd className="text-right tabular-nums">
              {fmt(num(order.totalPrice))} {order.currency}
            </dd>
            <dt className="text-ink-500">Transport za COGS</dt>
            <dd className="text-right tabular-nums">
              {fmt(num(order.freightCost))} {order.currency}
            </dd>
            <dt className="text-ink-500">Ukupna BM%</dt>
            <dd className="text-right tabular-nums">{fmt(num(order.bmPct))}%</dd>
          </dl>
        </Card>

        <div className="space-y-6">
          <Card className="p-0">
            <div className="border-b border-border/60 px-5 py-4">
              <h2 className="text-base font-semibold text-ink-900">Stavke porudžbenice</h2>
              <p className="text-sm text-ink-500">
                Unesite šifru artikla — naziv, nabavna cena, atributi i dimenzije se popunjavaju automatski.
              </p>
            </div>
            <div className="p-5">
              <DataTable
                columns={[
                  { key: "sku", label: "Šifra" },
                  { key: "name", label: "Naziv" },
                  { key: "price", label: "Nab. cena", align: "right" },
                  { key: "qty", label: "Količina", align: "right" },
                  { key: "volume", label: "Zapremina", align: "right" },
                  { key: "bm", label: "BM%", align: "right" },
                  { key: "actions", label: "", align: "right" },
                ]}
                rows={order.items.map((item) => ({
                  id: item.id,
                  cells: {
                    sku: item.sku,
                    name: (
                      <div>
                        <p className="font-medium text-ink-900">{item.name}</p>
                        {item.attributes || item.pattern ? (
                          <p className="text-xs text-ink-500">
                            {[item.attributes, item.pattern].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                      </div>
                    ),
                    price: `${fmt(num(item.purchasePrice))} ${item.currency}`,
                    qty: locked ? (
                      item.qty
                    ) : (
                      <form action={updateLineQty} className="flex items-center justify-end gap-1">
                        <input type="hidden" name="id" value={item.id} />
                        <Input
                          name="qty"
                          type="number"
                          min={1}
                          defaultValue={item.qty}
                          className="h-7 w-20 text-right"
                        />
                        <SubmitButton variant="outline" size="xs" pendingLabel="…">
                          OK
                        </SubmitButton>
                      </form>
                    ),
                    volume: fmt(num(item.totalVolume), 3),
                    bm: fmt(num(item.bmPct)),
                    actions: locked ? null : (
                      <form action={deleteLine}>
                        <input type="hidden" name="id" value={item.id} />
                        <ConfirmSubmitButton
                          size="xs"
                          confirm="Obrisati stavku?"
                          pendingLabel="…"
                        >
                          Obriši
                        </ConfirmSubmitButton>
                      </form>
                    ),
                  },
                }))}
                empty="Još nema stavki. Dodajte prvu ispod."
              />

              {locked ? (
                <p className="mt-4 rounded-lg border border-border/60 bg-muted-bg/40 px-3 py-2 text-sm text-ink-500">
                  Porudžbenica je primljena i zaključana za izmene.
                </p>
              ) : (
                <Card className="mt-4 bg-muted-bg/30">
                  <CardTitle>Dodaj stavku</CardTitle>
                  <AdminActionForm action={addLine} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="poId" value={order.id} />
                    <Field label="Šifra artikla" className="w-48">
                      <Input name="sku" required placeholder="npr. 100234" />
                    </Field>
                    <Field label="Količina" className="w-28">
                      <Input name="qty" type="number" min={1} defaultValue={1} required />
                    </Field>
                    <SubmitButton>Dodaj</SubmitButton>
                  </AdminActionForm>
                </Card>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle>Istorija statusa</CardTitle>
            {order.events.length ? (
              <ul className="space-y-2 text-sm">
                {order.events.map((event) => (
                  <li key={event.id} className="flex items-center justify-between gap-3">
                    <span className="text-ink-700">
                      {statusLabel[event.status]}
                      {event.note ? ` — ${event.note}` : ""}
                    </span>
                    <span className="shrink-0 text-xs text-ink-400">
                      {new Intl.DateTimeFormat("sr-Latn-RS", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(event.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">Još nema promena statusa.</p>
            )}
          </Card>
        </div>
      </div>

      <div className="px-8 pb-8">
        <Link href="/admin/erp/porudzbenice" className="text-sm text-walnut hover:underline">
          ← Nazad na pregled porudžbenica
        </Link>
      </div>
    </>
  );
}
