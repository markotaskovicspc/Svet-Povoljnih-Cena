import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  ErpCurrency,
  InboundInvoiceStatus,
  InboundInvoiceType,
  PurchaseOrderStatus,
} from "@prisma/client";
import { z } from "zod";
import { AdminActionForm } from "@/components/admin/action-form";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { PageHeader } from "@/components/admin/page-header";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createInboundInvoice,
  lockInboundInvoice,
  saveInboundInvoice,
} from "@/lib/admin/inbound-invoice.server";
import {
  calculateCogsBySku,
  weightedAverageCogs,
} from "@/lib/admin/inbound-invoice";
import type { AdminActionState } from "@/lib/admin/action-state";
import {
  requireAdminAction,
  withAdminState,
} from "@/lib/admin";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Ulazna faktura · ERP",
  robots: { index: false, follow: false },
};

const invoiceSchema = z.object({
  invoiceId: z.string().min(1),
  number: z.string().trim().min(1, "Broj fakture je obavezan.").max(100),
  receiptDate: z.iso.date(),
  supplierId: z.string().min(1, "Naziv dobavljača je obavezan."),
  purchaseOrderId: z.string().min(1, "Veza sa dokumentom je obavezna."),
  type: z.nativeEnum(InboundInvoiceType),
  currency: z.nativeEnum(ErpCurrency),
  exchangeRate: z.coerce.number().positive().max(1_000_000),
  netValue: z.coerce.number().nonnegative().max(1_000_000_000),
  vatValue: z.coerce.number().nonnegative().max(1_000_000_000),
  grossValue: z.coerce.number().nonnegative().max(1_000_000_000),
  notes: z.string().max(2000),
});

const statusLabel: Record<InboundInvoiceStatus, string> = {
  DRAFT: "Nacrt",
  RECEIVED: "Primljena",
  POSTED: "Zaključana",
  CANCELLED: "Storno",
};

function dateOnly(value?: Date | null) {
  return value?.toISOString().slice(0, 10) ?? "";
}

function fmt(value: number, digits = 2) {
  return new Intl.NumberFormat("sr-Latn-RS", {
    minimumFractionDigits: value % 1 ? Math.min(digits, 2) : 0,
    maximumFractionDigits: digits,
  }).format(value);
}

async function createAction() {
  "use server";
  const state = await withAdminState(
    {
      allowed: ["OPS"],
      action: "inbound-invoice.create",
      entity: "InboundInvoice",
    },
    async () => {
      const invoice = await createInboundInvoice();
      return {
        ok: true as const,
        entityId: invoice.id,
        result: { id: invoice.id },
      };
    },
  )();
  if (state.ok && state.result && typeof state.result === "object" && "id" in state.result) {
    redirect(`/admin/erp/ulazne-fakture/${String(state.result.id)}?mode=edit`);
  }
}

async function saveAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "inbound-invoice.save",
      entity: "InboundInvoice",
    },
    async (_actorId, actionData: FormData) => {
      const parsed = invoiceSchema.safeParse(Object.fromEntries(actionData.entries()));
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Neispravan unos.",
        };
      }
      const data = parsed.data;
      await saveInboundInvoice({
        id: data.invoiceId,
        number: data.number,
        receiptDate: new Date(`${data.receiptDate}T00:00:00.000Z`),
        supplierId: data.supplierId,
        purchaseOrderId: data.purchaseOrderId,
        type: data.type,
        currency: data.currency,
        exchangeRate: data.exchangeRate,
        netValue: data.netValue,
        vatValue: data.vatValue,
        grossValue: data.grossValue,
        notes: data.notes.trim() || null,
      });
      revalidatePath(`/admin/erp/ulazne-fakture/${data.invoiceId}`);
      revalidatePath("/admin/erp/ulazne-fakture");
      return {
        ok: true as const,
        entityId: data.invoiceId,
        message: "Ulazna faktura je sačuvana.",
      };
    },
  )(formData);
}

async function lockAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "inbound-invoice.lock",
      entity: "InboundInvoice",
    },
    async (_actorId, actionData: FormData) => {
      const id = String(actionData.get("invoiceId") ?? "");
      if (!id) return { ok: false as const, error: "Faktura nije izabrana." };
      await lockInboundInvoice(id);
      revalidatePath(`/admin/erp/ulazne-fakture/${id}`);
      revalidatePath("/admin/erp/ulazne-fakture");
      revalidatePath("/admin/erp/artikli");
      return {
        ok: true as const,
        entityId: id,
        message: "Faktura je zaključana i troškovi su uključeni u COGS.",
      };
    },
  )(formData);
}

export default async function InboundInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [invoice, suppliers, purchaseOrders] = await Promise.all([
    db.inboundInvoice.findUnique({
      where: { id },
      include: {
        supplier: true,
        purchaseOrder: {
          include: {
            items: {
              orderBy: { createdAt: "asc" },
              include: {
                product: {
                  select: { id: true, stock: true, cogs: true },
                },
              },
            },
            inboundInvoices: {
              select: {
                id: true,
                number: true,
                status: true,
                lockedAt: true,
                netValue: true,
                exchangeRate: true,
              },
            },
          },
        },
      },
    }),
    db.supplier.findMany({
      where: { enabled: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.purchaseOrder.findMany({
      where: { status: { not: PurchaseOrderStatus.CANCELLED } },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: {
        id: true,
        number: true,
        status: true,
        supplier: { select: { name: true } },
      },
    }),
  ]);
  if (!invoice) notFound();

  const locked = Boolean(invoice.lockedAt);
  const editing = query.mode === "edit" && !locked;
  const linkedCostRsd =
    invoice.purchaseOrder?.inboundInvoices
      .filter(
        (linked) =>
          linked.id === invoice.id ||
          (linked.lockedAt && linked.status === InboundInvoiceStatus.POSTED),
      )
      .reduce(
        (sum, linked) =>
          sum + Number(linked.netValue) * Number(linked.exchangeRate),
        0,
      ) ?? 0;
  const cogsRows = invoice.purchaseOrder
    ? calculateCogsBySku({
        orderExchangeRate: Number(invoice.purchaseOrder.exchangeRate),
        linkedInvoiceCostRsd: linkedCostRsd,
        lines: invoice.purchaseOrder.items.map((item) => ({
          id: item.id,
          sku: item.sku,
          qty: item.qty,
          purchasePrice: Number(item.purchasePrice),
          customsRatePct: Number(item.customsRate ?? 0),
          otherAllocatedRsd: Number(item.freightAllocated ?? 0),
        })),
      })
    : [];
  const productBySku = new Map(
    invoice.purchaseOrder?.items.map((item) => [item.sku, item.product]) ?? [],
  );

  return (
    <>
      <PageHeader
        title={`Ulazna faktura ${invoice.number}`}
        description={`${statusLabel[invoice.status]}${invoice.supplier ? ` · ${invoice.supplier.name}` : ""}${locked ? ` · zaključana ${dateOnly(invoice.lockedAt)}` : ""}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { href: "/admin/erp/ulazne-fakture", label: "Ulazne fakture" },
          { label: invoice.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <form action={createAction}>
              <SubmitButton variant="outline" pendingLabel="Kreiranje…">
                Nova
              </SubmitButton>
            </form>
            {!locked ? (
              editing ? (
                <Link
                  href={`/admin/erp/ulazne-fakture/${invoice.id}`}
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
                >
                  Završi uređivanje
                </Link>
              ) : (
                <Link
                  href={`/admin/erp/ulazne-fakture/${invoice.id}?mode=edit#podaci-fakture`}
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
                >
                  Uredi
                </Link>
              )
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex h-8 items-center rounded-lg border border-border bg-muted-bg px-2.5 text-sm font-medium text-ink-400"
              >
                Uredi
              </button>
            )}
            <AdminActionForm action={lockAction}>
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <SubmitButton
                disabled={locked}
                confirm="Zaključati fakturu? Poslovni podaci više neće moći da se menjaju, a trošak će ući u COGS."
                pendingLabel="Zaključavanje…"
              >
                Zaključaj
              </SubmitButton>
            </AdminActionForm>
          </div>
        }
      />

      <div className="space-y-6 px-4 py-6 md:px-8">
        <Card id="podaci-fakture">
          <CardTitle description="Vrednosti fakture i obavezna veza sa porudžbenicom.">
            Podaci fakture
          </CardTitle>
          {locked ? (
            <p className="mb-4 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
              Faktura je zaključana. Troškovi su raspoređeni po vrednosti artikala povezane porudžbenice.
            </p>
          ) : !editing ? (
            <p className="mb-4 rounded-lg border border-border/60 bg-muted-bg/40 px-3 py-2 text-sm text-ink-600">
              Izaberite komandu „Uredi” da promenite podatke, zatim „Zaključaj” za konačan COGS obračun.
            </p>
          ) : null}
          <AdminActionForm action={saveAction}>
            <fieldset
              key={`${invoice.updatedAt.toISOString()}-${editing}`}
              disabled={!editing || locked}
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            >
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <Field label="Broj fakture">
                <Input name="number" required defaultValue={invoice.number} />
              </Field>
              <Field label="Datum prijema">
                <Input
                  name="receiptDate"
                  type="date"
                  required
                  defaultValue={dateOnly(invoice.invoiceDate ?? invoice.createdAt)}
                />
              </Field>
              <Field label="Naziv dobavljača">
                <select
                  name="supplierId"
                  required
                  defaultValue={invoice.supplierId ?? ""}
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
              <Field label="Veza sa dokumentom" hint="Porudžbenica čiji artikli preuzimaju ovaj trošak.">
                <select
                  name="purchaseOrderId"
                  required
                  defaultValue={invoice.purchaseOrderId ?? ""}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">— izaberite porudžbenicu —</option>
                  {purchaseOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.number} · {order.supplier?.name ?? "bez dobavljača"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tip fakture">
                <select
                  name="type"
                  defaultValue={invoice.type}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value={InboundInvoiceType.DOM}>Domaća</option>
                  <option value={InboundInvoiceType.INO}>Inostrana</option>
                  <option value={InboundInvoiceType.COGS}>Zavisni trošak (COGS)</option>
                </select>
              </Field>
              <Field label="Valuta">
                <select
                  name="currency"
                  defaultValue={invoice.currency}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value={ErpCurrency.RSD}>RSD</option>
                  <option value={ErpCurrency.EUR}>EUR</option>
                  <option value={ErpCurrency.USD}>USD</option>
                </select>
              </Field>
              <Field label="Kurs prema RSD" hint="Za dinarsku fakturu unesite 1.">
                <Input
                  name="exchangeRate"
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  required
                  defaultValue={Number(invoice.exchangeRate)}
                />
              </Field>
              <Field label="Vrednost bez PDV-a">
                <Input
                  name="netValue"
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  defaultValue={Number(invoice.netValue)}
                />
              </Field>
              <Field label="PDV">
                <Input
                  name="vatValue"
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  defaultValue={Number(invoice.vatValue)}
                />
              </Field>
              <Field label="Bruto vrednost">
                <Input
                  name="grossValue"
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  defaultValue={Number(invoice.grossValue)}
                />
              </Field>
              <Field label="Napomena" className="md:col-span-2 xl:col-span-3">
                <Textarea name="notes" rows={3} defaultValue={invoice.notes ?? ""} />
              </Field>
              {editing && !locked ? (
                <div className="flex justify-end md:col-span-2 xl:col-span-3">
                  <SubmitButton pendingLabel="Čuvanje…">Sačuvaj</SubmitButton>
                </div>
              ) : null}
            </fieldset>
          </AdminActionForm>
        </Card>

        <Card>
          <CardTitle description="Neto vrednosti zaključanih vezanih faktura raspoređuju se srazmerno nabavnoj vrednosti svake šifre.">
            COGS obračun po šifri
          </CardTitle>
          {invoice.purchaseOrder ? (
            <>
              <div className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-lg bg-muted-bg/50 p-3">
                  <p className="text-ink-500">Porudžbenica</p>
                  <Link
                    href={`/admin/erp/porudzbenice/${invoice.purchaseOrder.id}`}
                    className="font-semibold text-walnut hover:underline"
                  >
                    {invoice.purchaseOrder.number}
                  </Link>
                </div>
                <div className="rounded-lg bg-muted-bg/50 p-3">
                  <p className="text-ink-500">Vezane fakture bez PDV-a</p>
                  <p className="font-semibold tabular-nums">{fmt(linkedCostRsd)} RSD</p>
                </div>
                <div className="rounded-lg bg-muted-bg/50 p-3">
                  <p className="text-ink-500">Način raspodele</p>
                  <p className="font-semibold">Prema vrednosti šifre</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[1120px] text-sm">
                  <thead className="bg-muted-bg/70 text-left text-xs uppercase tracking-[0.08em] text-ink-500">
                    <tr>
                      <th className="px-3 py-3">Šifra</th>
                      <th className="px-3 py-3 text-right">Količina</th>
                      <th className="px-3 py-3 text-right">Vrednost porudžbenice</th>
                      <th className="px-3 py-3 text-right">Carina</th>
                      <th className="px-3 py-3 text-right">Transport</th>
                      <th className="px-3 py-3 text-right">Vezane fakture</th>
                      <th className="px-3 py-3 text-right">COGS novog prijema / kom</th>
                      <th className="px-3 py-3 text-right">Postojeće stanje / COGS</th>
                      <th className="px-3 py-3 text-right">Finalni COGS / kom</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {cogsRows.map((row) => {
                      const product = productBySku.get(row.sku);
                      const existingQty = product?.stock ?? 0;
                      const existingCogs =
                        product?.cogs == null
                          ? row.incomingUnitCogsRsd
                          : Number(product.cogs);
                      const finalCogs =
                        invoice.purchaseOrder?.status === PurchaseOrderStatus.RECEIVED
                          ? existingCogs
                          : weightedAverageCogs({
                              existingQty,
                              existingUnitCogs: existingCogs,
                              incomingQty: row.qty,
                              incomingUnitCogs: row.incomingUnitCogsRsd,
                            });
                      return (
                        <tr key={row.sku}>
                          <td className="px-3 py-3 font-medium">{row.sku}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{row.qty}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{fmt(row.orderValueRsd)} RSD</td>
                          <td className="px-3 py-3 text-right tabular-nums">{fmt(row.customsRsd)} RSD</td>
                          <td className="px-3 py-3 text-right tabular-nums">{fmt(row.otherAllocatedRsd)} RSD</td>
                          <td className="px-3 py-3 text-right tabular-nums">{fmt(row.linkedInvoiceCostRsd)} RSD</td>
                          <td className="px-3 py-3 text-right font-medium tabular-nums">{fmt(row.incomingUnitCogsRsd)} RSD</td>
                          <td className="px-3 py-3 text-right tabular-nums">{existingQty} × {fmt(existingCogs)} RSD</td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums">{fmt(finalCogs)} RSD</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-xs text-ink-500">
                Finalni COGS = (postojeća količina × postojeći COGS + količina novog prijema × COGS novog prijema) / ukupna količina.
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-500">
              Izaberite vezu sa porudžbenicom da biste dobili COGS obračun po šifri.
            </p>
          )}
        </Card>

        <Link
          href="/admin/erp/ulazne-fakture"
          className="text-sm text-walnut hover:underline"
        >
          ← Nazad na pregled ulaznih faktura
        </Link>
      </div>
    </>
  );
}
