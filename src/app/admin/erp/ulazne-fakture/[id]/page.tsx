import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath, updateTag } from "next/cache";
import {
  InboundInvoiceStatus,
  PurchaseOrderStatus,
} from "@prisma/client";
import { z } from "zod";
import { AdminActionForm } from "@/components/admin/action-form";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import {
  InboundInvoiceFields,
  type InboundInvoicePurchaseOrderOption,
} from "@/components/admin/inbound-invoice-fields";
import { PageHeader } from "@/components/admin/page-header";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelInboundInvoice,
  createInboundInvoice,
  lockInboundInvoice,
  postInboundInvoice,
  saveInboundInvoice,
} from "@/lib/admin/inbound-invoice.server";
import {
  calculateLinkedInvoiceAdjustmentRsd,
  calculatePurchaseOrderInvoiceDefaults,
  calculateCogsBySku,
  weightedAverageCogs,
} from "@/lib/admin/inbound-invoice";
import { goodsReceiptMasterWarnings } from "@/lib/admin/goods-receipt-readiness";
import type { AdminActionState } from "@/lib/admin/action-state";
import {
  purchaseOrderCapacityWarnings,
  resolveOpenPurchaseOrderCustomsRate,
} from "@/lib/admin/purchase-order";
import {
  requireAdminAction,
  withAdminState,
} from "@/lib/admin";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Prijemnica · ERP",
  robots: { index: false, follow: false },
};

const invoiceSchema = z.object({
  invoiceId: z.string().min(1),
  number: z.string().trim().min(1, "Broj prijemnice je obavezan.").max(100),
  receiptDate: z.iso.date(),
  supplierId: z.string().min(1, "Naziv dobavljača je obavezan."),
  purchaseOrderId: z.string().min(1, "Veza sa dokumentom je obavezna."),
  warehouseId: z.string().min(1, "Magacin prijema je obavezan."),
  type: z.literal("COGS"),
  currency: z.literal("RSD"),
  exchangeRate: z.coerce.number().refine((value) => value === 1),
  invoiceValueRsd: z.coerce.number().nonnegative().max(1_000_000_000),
  customsValueRsd: z.coerce.number().nonnegative().max(1_000_000_000),
  transportValueRsd: z.coerce.number().nonnegative().max(1_000_000_000),
  otherRelatedCostsRsd: z.coerce
    .number()
    .nonnegative()
    .max(1_000_000_000),
  netValue: z.coerce.number().nonnegative().max(1_000_000_000),
  vatValue: z.coerce.number().nonnegative().max(1_000_000_000),
  grossValue: z.coerce.number().nonnegative().max(1_000_000_000),
  notes: z.string().max(2000),
});

const statusLabel: Record<InboundInvoiceStatus, string> = {
  DRAFT: "Nacrt",
  RECEIVED: "Primljena",
  POSTED: "Proknjižena",
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

function optionalNumber(value: unknown) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function effectiveCustomsRate(
  item: {
    customsRate: unknown;
    product?: { customsRate: unknown } | null;
  },
  orderLockedAt: Date | null,
) {
  const itemCustomsRate = optionalNumber(item.customsRate);
  if (orderLockedAt) return itemCustomsRate;
  return resolveOpenPurchaseOrderCustomsRate({
    itemCustomsRate,
    productCustomsRate: optionalNumber(item.product?.customsRate),
  });
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
  const shouldPost = formData.get("intent") === "post";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: shouldPost
        ? "inbound-invoice.save-and-post"
        : "inbound-invoice.save",
      entity: "InboundInvoice",
    },
    async (actorId, actionData: FormData) => {
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
        purchaseOrderId: data.purchaseOrderId,
        warehouseId: data.warehouseId,
        invoiceValueRsd: data.invoiceValueRsd,
        customsValueRsd: data.customsValueRsd,
        transportValueRsd: data.transportValueRsd,
        otherRelatedCostsRsd: data.otherRelatedCostsRsd,
        notes: data.notes.trim() || null,
      });
      revalidatePath(`/admin/erp/ulazne-fakture/${data.invoiceId}`);
      revalidatePath("/admin/erp/ulazne-fakture");

      if (shouldPost) {
        try {
          const result = await postInboundInvoice(data.invoiceId, actorId);
          revalidatePath("/admin/erp/porudzbenice");
          revalidatePath("/admin/erp/stanje-po-magacinima");
          revalidatePath("/admin/erp/artikli");
          updateTag("catalog-products");
          return {
            ok: true as const,
            entityId: data.invoiceId,
            diff: {
              masterWarnings: result.masterWarnings,
              countryOriginFallbacks: result.countryOriginFallbacks,
            },
            message: `Prijemnica i porudžbenica su proknjižene, a roba je primljena u magacin ${result.warehouseName}.`,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Nepoznata greška.";
          throw new Error(`${message} Uneti podaci fakture su sačuvani.`);
        }
      }

      return {
        ok: true as const,
        entityId: data.invoiceId,
        message: "Prijemnica je sačuvana.",
      };
    },
  )(formData);
}

async function postAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "inbound-invoice.post",
      entity: "InboundInvoice",
    },
    async (actorId, actionData: FormData) => {
      const id = String(actionData.get("invoiceId") ?? "");
      if (!id) return { ok: false as const, error: "Prijemnica nije izabrana." };
      const backfillOnly = actionData.get("backfillOnly") === "true";
      const result = backfillOnly
        ? (await lockInboundInvoice(id), null)
        : await postInboundInvoice(id, actorId);
      revalidatePath(`/admin/erp/ulazne-fakture/${id}`);
      revalidatePath("/admin/erp/ulazne-fakture");
      revalidatePath("/admin/erp/porudzbenice");
      revalidatePath("/admin/erp/stanje-po-magacinima");
      revalidatePath("/admin/erp/artikli");
      if (!backfillOnly) updateTag("catalog-products");
      return {
        ok: true as const,
        entityId: id,
        diff: backfillOnly
          ? undefined
          : {
              masterWarnings: result?.masterWarnings ?? [],
              countryOriginFallbacks: result?.countryOriginFallbacks ?? [],
            },
        message: backfillOnly
          ? "COGS ranije proknjižene prijemnice je usklađen."
          : `Prijemnica i porudžbenica su proknjižene, a roba je primljena u magacin ${result?.warehouseName ?? ""}.`,
      };
    },
  )(formData);
}

async function cancelAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "inbound-invoice.cancel",
      entity: "InboundInvoice",
    },
    async (_actorId, actionData: FormData) => {
      const id = String(actionData.get("invoiceId") ?? "");
      if (!id) return { ok: false as const, error: "Prijemnica nije izabrana." };
      await cancelInboundInvoice(id);
      revalidatePath(`/admin/erp/ulazne-fakture/${id}`);
      revalidatePath("/admin/erp/ulazne-fakture");
      revalidatePath("/admin/erp/artikli");
      return {
        ok: true as const,
        entityId: id,
        message: "Prijemnica je stornirana; COGS i količina u dolasku su preračunati.",
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
  const [invoice, purchaseOrders, warehouses] = await Promise.all([
    db.inboundInvoice.findUnique({
      where: { id },
      include: {
        supplier: true,
        warehouse: true,
        purchaseOrder: {
          include: {
            supplier: { select: { id: true, name: true } },
            receivingWarehouse: true,
            transportDefinition: true,
            items: {
              orderBy: { createdAt: "asc" },
              include: {
                product: {
                  select: {
                    id: true,
                    sku: true,
                    name: true,
                    description: true,
                    stock: true,
                    cogs: true,
                    customsRate: true,
                    supplierId: true,
                    supplier: { select: { country: true } },
                    countryOfOrigin: true,
                    hsCode: true,
                    widthCm: true,
                    depthCm: true,
                    heightCm: true,
                    grossWeightKg: true,
                    packQty: true,
                    packWidthCm: true,
                    packDepthCm: true,
                    packHeightCm: true,
                    packGrossWeightKg: true,
                    containerQty: true,
                    containerGrossWeightKg: true,
                    categories: { select: { categoryId: true } },
                    priceListEntries: {
                      where: {
                        price: { gt: 0 },
                        validFrom: { lte: new Date() },
                        OR: [
                          { validTo: null },
                          { validTo: { gte: new Date() } },
                        ],
                        priceList: { kind: "RETAIL", active: true },
                      },
                      take: 1,
                      select: { id: true },
                    },
                  },
                },
              },
            },
            inboundInvoices: {
              where: { status: { not: InboundInvoiceStatus.CANCELLED } },
              select: {
                id: true,
                number: true,
                status: true,
                lockedAt: true,
                netValue: true,
                exchangeRate: true,
                invoiceValueRsd: true,
              },
            },
          },
        },
      },
    }),
    db.purchaseOrder.findMany({
      where: {
        status: { not: PurchaseOrderStatus.CANCELLED },
        OR: [
          {
            inboundInvoices: {
              none: { status: { not: InboundInvoiceStatus.CANCELLED } },
            },
          },
          { inboundInvoices: { some: { id } } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: {
        id: true,
        number: true,
        status: true,
        lockedAt: true,
        exchangeRate: true,
        freightCost: true,
        freightExchangeRate: true,
        supplier: { select: { id: true, name: true } },
        items: {
          select: {
            qty: true,
            purchasePrice: true,
            customsRate: true,
            product: { select: { customsRate: true } },
          },
        },
      },
    }),
    db.warehouse.findMany({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        isDefault: true,
      },
    }),
  ]);
  if (!invoice) notFound();

  const locked = Boolean(invoice.lockedAt);
  const cancelled = invoice.status === InboundInvoiceStatus.CANCELLED;
  const immutable = locked || cancelled;
  const cogsNeedsBackfill = Boolean(
    locked &&
      !cancelled &&
      invoice.purchaseOrder &&
      invoice.purchaseOrder.status !== PurchaseOrderStatus.RECEIVED &&
      !invoice.purchaseOrder.cogsBookedAt,
  );
  const receiptNeedsCompletion = Boolean(
    locked &&
      !cancelled &&
      invoice.purchaseOrder &&
      invoice.purchaseOrder.status !== PurchaseOrderStatus.RECEIVED &&
      invoice.purchaseOrder.cogsBookedAt,
  );
  const receiptWarehouse =
    invoice.warehouse ?? invoice.purchaseOrder?.receivingWarehouse ?? null;
  const editing = query.mode === "edit" && !immutable;
  const capacityWarnings = invoice.purchaseOrder
    ? purchaseOrderCapacityWarnings({
        totalVolumeM3: Number(invoice.purchaseOrder.totalVolume ?? 0),
        totalWeightKg: Number(invoice.purchaseOrder.totalWeight ?? 0),
        payloadM3:
          invoice.purchaseOrder.transportDefinition?.payloadM3 == null
            ? null
            : Number(invoice.purchaseOrder.transportDefinition.payloadM3),
        payloadKg:
          invoice.purchaseOrder.transportDefinition?.payloadKg == null
            ? null
            : Number(invoice.purchaseOrder.transportDefinition.payloadKg),
      })
    : [];
  const masterWarnings = invoice.purchaseOrder
    ? goodsReceiptMasterWarnings(invoice.purchaseOrder.items)
    : [];
  const masterWarningConfirmation = masterWarnings.length
    ? `Master artikala nije kompletan za ${masterWarnings.length} ${masterWarnings.length === 1 ? "stavku" : "stavki"}. Prijem će ipak biti proknjižen, a podatke treba dopuniti naknadno. Da li želite da nastavite? `
    : "";
  const selectablePurchaseOrders =
    invoice.purchaseOrder &&
    !purchaseOrders.some((order) => order.id === invoice.purchaseOrder?.id)
      ? [invoice.purchaseOrder, ...purchaseOrders]
      : purchaseOrders;
  const purchaseOrderOptions: InboundInvoicePurchaseOrderOption[] = selectablePurchaseOrders.map(
    (order) => {
      const defaults = calculatePurchaseOrderInvoiceDefaults({
        exchangeRate: Number(order.exchangeRate),
        freightCost: Number(order.freightCost),
        freightExchangeRate: Number(order.freightExchangeRate),
        lines: order.items.map((item) => ({
          qty: item.qty,
          purchasePrice: Number(item.purchasePrice),
          customsRatePct: effectiveCustomsRate(item, order.lockedAt),
        })),
      });
      return {
        id: order.id,
        number: order.number,
        supplierId: order.supplier?.id ?? null,
        supplierName: order.supplier?.name ?? null,
        ...defaults,
      };
    },
  );
  const relevantInvoices = invoice.purchaseOrder?.inboundInvoices ?? [];
  const purchaseOrderDefaults = invoice.purchaseOrder
    ? calculatePurchaseOrderInvoiceDefaults({
        exchangeRate: Number(invoice.purchaseOrder.exchangeRate),
        freightCost: Number(invoice.purchaseOrder.freightCost),
        freightExchangeRate: Number(invoice.purchaseOrder.freightExchangeRate),
        lines: invoice.purchaseOrder.items.map((item) => ({
          qty: item.qty,
          purchasePrice: Number(item.purchasePrice),
          customsRatePct: effectiveCustomsRate(
            item,
            invoice.purchaseOrder?.lockedAt ?? null,
          ),
        })),
      })
    : null;
  const purchaseOrderBaselineRsd = purchaseOrderDefaults
    ? purchaseOrderDefaults.invoiceValueRsd +
      purchaseOrderDefaults.customsValueRsd +
      purchaseOrderDefaults.transportValueRsd
    : 0;
  const linkedNetValueRsd = relevantInvoices.reduce(
    (sum, linked) => sum + Number(linked.netValue) * Number(linked.exchangeRate),
    0,
  );
  const linkedCostAdjustmentRsd = calculateLinkedInvoiceAdjustmentRsd({
    purchaseOrderBaselineRsd,
    invoices: relevantInvoices.map((linked) => ({
      netValue: Number(linked.netValue),
      exchangeRate: Number(linked.exchangeRate),
      invoiceValueRsd:
        linked.invoiceValueRsd == null ? null : Number(linked.invoiceValueRsd),
    })),
  });
  const cogsRows = invoice.purchaseOrder
    ? calculateCogsBySku({
        orderExchangeRate: Number(invoice.purchaseOrder.exchangeRate),
        linkedInvoiceCostRsd: linkedCostAdjustmentRsd,
        lines: invoice.purchaseOrder.items.map((item) => ({
          id: item.id,
          sku: item.sku,
          qty: item.qty,
          purchasePrice: Number(item.purchasePrice),
          customsRatePct: effectiveCustomsRate(
            item,
            invoice.purchaseOrder?.lockedAt ?? null,
          ),
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
        title={`Prijemnica ${invoice.number}`}
        description={`${statusLabel[invoice.status]}${invoice.supplier ? ` · ${invoice.supplier.name}` : ""}${receiptWarehouse ? ` · ${receiptWarehouse.name}` : ""}${locked ? ` · proknjižena ${dateOnly(invoice.lockedAt)}` : ""}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { href: "/admin/erp/ulazne-fakture", label: "Prijemnice" },
          { label: invoice.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <form action={createAction}>
              <SubmitButton variant="outline" pendingLabel="Kreiranje…">
                Nova
              </SubmitButton>
            </form>
            {!immutable ? (
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
            {editing ? (
              <SubmitButton
                form="inbound-invoice-form"
                name="intent"
                value="post"
                disabled={
                  cancelled ||
                  (locked && !cogsNeedsBackfill && !receiptNeedsCompletion)
                }
                confirm={
                  cogsNeedsBackfill
                    ? "Uskladiti COGS ove ranije proknjižene prijemnice?"
                    : receiptNeedsCompletion
                      ? `${masterWarningConfirmation}Knjiženje prijemnice i porudžbenice je već započeto. Dovršiti prijem robe u izabrani magacin?`
                    : `${masterWarningConfirmation}${capacityWarnings.length ? `Kapacitet je prekoračen. ${capacityWarnings.join(" ")} Da li ipak želite da nastavite? ` : ""}Proknjižiti prijemnicu i povezanu porudžbenicu i odmah primiti robu u izabrani magacin? Posle ovoga redovno uređivanje nije moguće.`
                }
                pendingLabel={
                  cogsNeedsBackfill
                    ? "Usklađivanje COGS-a…"
                    : receiptNeedsCompletion
                      ? "Dovršavanje prijema…"
                      : "Knjiženje…"
                }
              >
                {cogsNeedsBackfill
                  ? "Uskladi COGS"
                  : receiptNeedsCompletion
                    ? "Dovrši prijem"
                    : "Proknjiži"}
              </SubmitButton>
            ) : (
              <AdminActionForm action={postAction}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input
                  type="hidden"
                  name="backfillOnly"
                  value={cogsNeedsBackfill ? "true" : "false"}
                />
                <SubmitButton
                  disabled={
                    cancelled ||
                    (locked && !cogsNeedsBackfill && !receiptNeedsCompletion)
                  }
                  confirm={
                    cogsNeedsBackfill
                      ? "Uskladiti COGS ove ranije proknjižene prijemnice?"
                      : receiptNeedsCompletion
                        ? `${masterWarningConfirmation}Knjiženje prijemnice i porudžbenice je već započeto. Dovršiti prijem robe u izabrani magacin?`
                        : `${masterWarningConfirmation}${capacityWarnings.length ? `Kapacitet je prekoračen. ${capacityWarnings.join(" ")} Da li ipak želite da nastavite? ` : ""}Proknjižiti prijemnicu i povezanu porudžbenicu i odmah primiti robu u izabrani magacin? Posle ovoga redovno uređivanje nije moguće.`
                  }
                  pendingLabel={
                    cogsNeedsBackfill
                      ? "Usklađivanje COGS-a…"
                      : receiptNeedsCompletion
                        ? "Dovršavanje prijema…"
                        : "Knjiženje…"
                  }
                >
                  {cogsNeedsBackfill
                    ? "Uskladi COGS"
                    : receiptNeedsCompletion
                      ? "Dovrši prijem"
                      : "Proknjiži"}
                </SubmitButton>
              </AdminActionForm>
            )}
            <AdminActionForm action={cancelAction}>
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <SubmitButton
                variant="destructive"
                disabled={cancelled || locked}
                confirm="Stornirati prijemnicu? COGS i količina u dolasku biće ponovo izračunati."
                pendingLabel="Storniranje…"
              >
                Storniraj
              </SubmitButton>
            </AdminActionForm>
          </div>
        }
      />

      <div className="space-y-6 px-4 py-6 md:px-8">
        {masterWarnings.length && (!locked || receiptNeedsCompletion) ? (
          <div
            role="status"
            className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning"
          >
            <p className="font-semibold">
              Upozorenje — master artikala nije kompletan:
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {masterWarnings.map((warning) => (
                <li key={`${warning.sku}-${warning.issues.join("-")}`}>
                  {warning.productId ? (
                    <Link
                      href={`/admin/erp/artikli/${warning.productId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold underline underline-offset-2"
                    >
                      {warning.sku}
                    </Link>
                  ) : (
                    <span className="font-semibold">{warning.sku}</span>
                  )}
                  : {warning.issues.join(", ")}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              Zemlja dobavljača se koristi kao fallback kada zemlja porekla starog
              artikla nije upisana. Ostale podatke dopunite preko linkova; knjiženje
              nije blokirano i traži dodatnu potvrdu.
            </p>
          </div>
        ) : null}
        {capacityWarnings.length && !locked ? (
          <div
            role="status"
            className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning"
          >
            <p className="font-semibold">
              Informativno upozorenje — kapacitet transporta je prekoračen:
            </p>
            <ul className="mt-1 list-disc pl-5">
              {capacityWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <p className="mt-2">
              Knjiženje nije blokirano; komanda „Proknjiži” traži dodatnu potvrdu.
            </p>
          </div>
        ) : null}
        <Card id="podaci-fakture">
          <CardTitle description="Vrednosti fakture, veza sa porudžbenicom i magacin stvarnog prijema robe.">
            Podaci prijemnice
          </CardTitle>
          {cancelled ? (
            <p className="mb-4 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
              Prijemnica je stornirana i više ne učestvuje u COGS-u ni količini u dolasku.
            </p>
          ) : receiptNeedsCompletion ? (
            <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              Prijemnica i porudžbenica su proknjižene, ali prijem robe nije završen.
              {receiptWarehouse
                ? ` Prijem će biti završen u magacin ${receiptWarehouse.name} (${receiptWarehouse.code}).`
                : " Magacin prijema nije izabran."}{" "}
              Izaberite „Dovrši prijem”; nepotpuni master podaci biće zabeleženi
              kao upozorenje.
            </p>
          ) : cogsNeedsBackfill ? (
            <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              Prijemnica je proknjižena pre uvođenja trenutnog COGS workflow-a. Izaberite „Uskladi COGS” da upišete obračunate vrednosti na artikle.
            </p>
          ) : locked ? (
            <p className="mb-4 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
              Prijemnica je proknjižena. Troškovi i COGS su obračunati, porudžbenica je završena, a roba je primljena u izabrani magacin.
            </p>
          ) : !editing ? (
            <p className="mb-4 rounded-lg border border-border/60 bg-muted-bg/40 px-3 py-2 text-sm text-ink-600">
              Izaberite „Uredi” da dopunite podatke, zatim „Proknjiži” da završite prijemnicu, porudžbenicu i prijem robe.
            </p>
          ) : null}
          <AdminActionForm action={saveAction} id="inbound-invoice-form">
            <fieldset
              key={`${invoice.id}-${editing}`}
              disabled={!editing || immutable}
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            >
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <Field label="Broj prijemnice">
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
              <Field label="Magacin prijema">
                <select
                  name="warehouseId"
                  required
                  defaultValue={
                    invoice.warehouseId ??
                    invoice.purchaseOrder?.receivingWarehouseId ??
                    ""
                  }
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">— izaberite —</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name} ({warehouse.code})
                      {warehouse.isDefault ? " · podrazumevani" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <InboundInvoiceFields
                purchaseOrders={purchaseOrderOptions}
                editing={editing}
                initial={{
                  purchaseOrderId: invoice.purchaseOrderId,
                  supplierId: invoice.supplierId,
                  supplierName: invoice.supplier?.name ?? null,
                  invoiceValueRsd:
                    invoice.invoiceValueRsd == null
                      ? null
                      : Number(invoice.invoiceValueRsd),
                  customsValueRsd:
                    invoice.customsValueRsd == null
                      ? null
                      : Number(invoice.customsValueRsd),
                  transportValueRsd:
                    invoice.transportValueRsd == null
                      ? null
                      : Number(invoice.transportValueRsd),
                  otherRelatedCostsRsd:
                    invoice.otherRelatedCostsRsd == null
                      ? null
                      : Number(invoice.otherRelatedCostsRsd),
                  legacyNetValue: Number(invoice.netValue),
                }}
              />
              <Field label="Napomena" className="md:col-span-2 xl:col-span-3">
                <Textarea name="notes" rows={3} defaultValue={invoice.notes ?? ""} />
              </Field>
              {editing && !immutable ? (
                <div className="flex justify-end md:col-span-2 xl:col-span-3">
                  <SubmitButton pendingLabel="Čuvanje…">Sačuvaj</SubmitButton>
                </div>
              ) : null}
            </fieldset>
          </AdminActionForm>
        </Card>

        <Card>
          <CardTitle description="Neto vrednosti proknjiženih vezanih faktura raspoređuju se srazmerno nabavnoj vrednosti svake šifre.">
            COGS obračun po šifri
          </CardTitle>
          {invoice.purchaseOrder ? (
            <>
              <div className="mb-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
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
                  <p className="text-ink-500">Ukupno bez PDV-a</p>
                  <p className="font-semibold tabular-nums">{fmt(linkedNetValueRsd)} RSD</p>
                </div>
                <div className="rounded-lg bg-muted-bg/50 p-3">
                  <p className="text-ink-500">COGS korekcija</p>
                  <p className="font-semibold tabular-nums">{fmt(linkedCostAdjustmentRsd)} RSD</p>
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
                      <th className="px-3 py-3 text-right">Korekcija iz fakture</th>
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
                        (locked ||
                          invoice.purchaseOrder?.status ===
                            PurchaseOrderStatus.RECEIVED) &&
                        product?.cogs != null
                          ? Number(product.cogs)
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
                Finalni COGS = (postojeća količina × postojeći COGS + količina sa fakture × COGS te nabavke) / ukupna količina. Komanda „Proknjiži” obračunava COGS i knjiži količinu u izabrani magacin bez duplog obračuna.
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
          ← Nazad na pregled prijemnica
        </Link>
      </div>
    </>
  );
}
