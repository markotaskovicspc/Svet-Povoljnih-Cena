import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { OrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { createShipmentForOrder, syncCourierShipmentById } from "@/lib/courier";
import { issueAndDeliverFiscalReceipt } from "@/lib/fiscal";
import { issueBuyerReceiptForOrder } from "@/lib/receipts";
import { ipsPaymentProvider, IpsConfigError, IpsGatewayError } from "@/lib/payments";
import { getXExpressConfig, X_EXPRESS_PROVIDER } from "@/lib/x-express/config";
import {
  deleteMyGlsLabelsForShipment,
  getMyGlsConfig,
  getSmallParcelProvider,
  modifyMyGlsCODForShipment,
  MYGLS_PROVIDER,
} from "@/lib/mygls";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import { adjustInventory } from "@/lib/inventory";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/admin/data-table";
import { AdminActionForm } from "@/components/admin/action-form";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Narudžbina",
  robots: { index: false, follow: false },
};

async function updateStatus(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "order.statusUpdate", entity: "Order" },
    async (actorId, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        const status = String(formData.get("status") ?? "") as OrderStatus;
        const note = String(formData.get("note") ?? "").trim() || null;
        if (!id || !Object.values(OrderStatus).includes(status)) {
          return { ok: false as const, error: "Nedostaje ID ili status." };
        }
        await db.$transaction(async (tx) => {
          const existing = await tx.order.findUnique({
            where: { id },
            select: {
              number: true,
              stockRestoredAt: true,
              items: { select: { id: true, productId: true, qty: true, sku: true } },
            },
          });
          if (!existing) throw new Error("Porudžbina ne postoji.");
          const shouldRestore = status === "OTKAZANO" && !existing.stockRestoredAt;
          const now = new Date();
          const updated = await tx.order.updateMany({
            where: {
              id,
              ...(shouldRestore ? { stockRestoredAt: null } : {}),
            },
            data: {
              status,
              ...(shouldRestore ? { cancelledAt: now, stockRestoredAt: now } : {}),
            },
          });
          if (updated.count !== 1) return;
          if (shouldRestore) {
            for (const item of existing.items) {
              if (!item.productId) continue;
              await adjustInventory(tx, {
                idempotencyKey: `order:${id}:cancel:${item.id}`,
                productId: item.productId,
                sku: item.sku,
                qtyDelta: item.qty,
                kind: "ADJUSTMENT",
                orderId: id,
                actorId,
                note: `Otkazivanje porudžbine ${existing.number}`,
              });
            }
          }
          await tx.orderStatusEvent.create({
            data: { orderId: id, status, note, actorId },
          });
        });
        await enqueueBackgroundJob({
          kind: "ORDER_STATUS_EMAIL",
          payload: { orderId: id },
          idempotencyKey: `order-status-email:${id}:${status}`,
        });
        if (status === "SPREMNO_ZA_ISPORUKU" && smallParcelAutoCreateEnabled()) {
          await createShipmentForOrder(id);
        }
        revalidatePath(`/admin/narudzbine/${id}`);
        revalidatePath("/admin/narudzbine");
        return {
          ok: true as const,
          entityId: id,
          diff: { status, note },
          message: "Status porudžbine je ažuriran.",
        };
      },
  )(formData);
}

async function createCourierShipment(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "order.courierCreate", entity: "Shipment" },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      const packageCount = Math.max(
        1,
        Math.min(99, Number(formData.get("packageCount") ?? 1) || 1),
      );
      if (!id) return { ok: false as const, error: "Nedostaje ID porudžbine." };
      // createShipmentForOrder throws on failure but still persists a FAILED
      // shipment row — revalidate in `finally` so that row is visible without a
      // hard reload, and surface the error instead of swallowing it (Bug #10).
      try {
        const shipment = await createShipmentForOrder(id, { packageCount });
        return {
          ok: true as const,
          entityId: shipment.id,
          diff: { provider: shipment.provider, trackingNo: shipment.trackingNo },
          message: `Kurirski nalog je kreiran (${shipment.provider}${
            shipment.trackingNo ? ` · ${shipment.trackingNo}` : ""
          }).`,
        };
      } finally {
        revalidatePath(`/admin/narudzbine/${id}`);
        revalidatePath("/admin/narudzbine");
      }
    },
  )(formData);
}

async function syncCourierShipment(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "order.courierStatusSync", entity: "Shipment" },
    async (_actorId, formData: FormData) => {
      const shipmentId = String(formData.get("shipmentId") ?? "");
      const orderId = String(formData.get("orderId") ?? "");
      if (!shipmentId || !orderId) {
        return { ok: false as const, error: "Nedostaje ID pošiljke." };
      }
      try {
        const result = await syncCourierShipmentById(shipmentId);
        return {
          ok: true as const,
          entityId: shipmentId,
          diff: result,
          message: "Status pošiljke je sinhronizovan.",
        };
      } finally {
        revalidatePath(`/admin/narudzbine/${orderId}`);
        revalidatePath("/admin/narudzbine");
      }
    },
  )(formData);
}

async function deleteMyGlsShipment(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "order.myGlsDeleteLabels", entity: "Shipment" },
    async (_actorId, formData: FormData) => {
      const shipmentId = String(formData.get("shipmentId") ?? "");
      const orderId = String(formData.get("orderId") ?? "");
      if (!shipmentId || !orderId) {
        return { ok: false as const, error: "Nedostaje ID pošiljke." };
      }
      try {
        const result = await deleteMyGlsLabelsForShipment(shipmentId);
        return {
          ok: true as const,
          entityId: shipmentId,
          diff: result,
          message: "MyGLS nalog je otkazan.",
        };
      } finally {
        revalidatePath(`/admin/narudzbine/${orderId}`);
        revalidatePath("/admin/narudzbine");
      }
    },
  )(formData);
}

async function modifyMyGlsCOD(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "order.myGlsModifyCOD", entity: "Shipment" },
    async (_actorId, formData: FormData) => {
      const shipmentId = String(formData.get("shipmentId") ?? "");
      const orderId = String(formData.get("orderId") ?? "");
      const codAmount = Number(formData.get("codAmount") ?? "");
      if (!shipmentId || !orderId || !Number.isFinite(codAmount) || codAmount < 0) {
        return { ok: false as const, error: "Neispravan COD iznos." };
      }
      try {
        const result = await modifyMyGlsCODForShipment(shipmentId, codAmount);
        return {
          ok: true as const,
          entityId: shipmentId,
          diff: result,
          message: "COD iznos je izmenjen.",
        };
      } finally {
        revalidatePath(`/admin/narudzbine/${orderId}`);
        revalidatePath("/admin/narudzbine");
      }
    },
  )(formData);
}

async function issueFiscalReceiptAction(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "order.fiscalIssue", entity: "FiscalReceipt" },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      if (!id) return { ok: false as const, error: "Nedostaje ID porudžbine." };
      const existing = await db.fiscalDocument.findFirst({
        where: { orderId: id, kind: "SALE", status: "ISSUED" },
        select: { id: true },
      });
      const result = await issueAndDeliverFiscalReceipt(id, {
        forceEmail: Boolean(existing),
        source: "MANUAL",
      });
      revalidatePath(`/admin/narudzbine/${id}`);
      if (!result.outcome.ok) {
        return {
          ok: false as const,
          error: result.outcome.error,
        };
      }
      return {
        ok: true as const,
        entityId: result.outcome.receipt.id,
        diff: {
          receiptNumber: result.outcome.receipt.receiptNumber,
          emailed: result.emailed,
          emailError: result.emailError,
        },
        message: result.emailed
          ? "Fiskalni račun je izdat i poslat kupcu."
          : "Fiskalni račun je izdat, ali slanje e-pošte nije potvrđeno.",
      };
    },
  )(formData);
}

async function resendBuyerReceiptAction(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "invoice.buyerReceiptResend", entity: "Invoice" },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      if (!id) return { ok: false as const, error: "Nedostaje ID porudžbine." };
      const result = await issueBuyerReceiptForOrder(id, {
        sendEmail: true,
        forceEmail: true,
      });
      revalidatePath(`/admin/narudzbine/${id}`);
      return result.ok
        ? {
            ok: true as const,
            entityId: result.invoiceId,
            diff: { number: result.number, emailed: result.emailed },
            message: result.emailed
              ? "Predračun/račun je ponovo poslat kupcu."
              : "Predračun/račun je regenerisan, ali slanje nije potvrđeno.",
          }
        : { ok: false as const, error: result.error };
    },
  )(formData);
}

async function markFiscalized(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "order.markFiscalized", entity: "Order" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        const receiptNumber = String(formData.get("receiptNumber") ?? "").trim();
        if (!id || !receiptNumber) {
          return { ok: false as const, error: "Nedostaje broj fiskalnog računa." };
        }
        await db.fiscalReceipt.upsert({
          where: { orderId: id },
          create: { orderId: id, receiptNumber },
          update: { receiptNumber },
        });
        revalidatePath(`/admin/narudzbine/${id}`);
        return {
          ok: true as const,
          entityId: id,
          diff: { receiptNumber },
          message: "Broj fiskalnog računa je sačuvan.",
        };
      },
  )(formData);
}

async function refundIpsPaymentAction(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "order.ipsRefund", entity: "Payment" },
    async (actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      const amount = Number(formData.get("amount") ?? "");
      const requestId = String(formData.get("refundRequestId") ?? "");
      if (!id || !requestId || !Number.isFinite(amount) || amount <= 0) {
        return { ok: false as const, error: "Unesite ispravan iznos za IPS povraćaj." };
      }

      const order = await db.order.findUnique({
        where: { id },
        select: {
          id: true,
          number: true,
          total: true,
          paymentMethod: true,
          payments: {
            where: { provider: "IPS" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { status: true, paymentReference: true },
          },
        },
      });
      if (!order) return { ok: false as const, error: "Porudžbina nije pronađena." };
      if (order.paymentMethod !== "IPS") {
        return { ok: false as const, error: "Ova porudžbina nije plaćena IPS metodom." };
      }

      const total = num(order.total);
      if (amount > total) {
        return {
          ok: false as const,
          error: "Iznos povraćaja ne može biti veći od iznosa porudžbine.",
        };
      }

      const latestPayment = order.payments[0] ?? null;
      if (!latestPayment || !["PAID", "PARTIAL_REFUND"].includes(latestPayment.status)) {
        return {
          ok: false as const,
          error: "IPS povraćaj je moguć samo za plaćenu IPS transakciju.",
        };
      }

      try {
        const result = await ipsPaymentProvider.refundPayment(order.number, amount, {
          idempotencyKey: `admin:${requestId}`,
          actorId,
        });
        if (!result.refunded) {
          return {
            ok: false as const,
            error: `IPS nije potvrdio povraćaj (kod ${result.responseCode || "—"}).`,
          };
        }
      } catch (err) {
        if (err instanceof IpsConfigError) {
          return { ok: false as const, error: "IPS nije konfigurisan." };
        }
        if (err instanceof IpsGatewayError) {
          return {
            ok: false as const,
            error: `IPS gateway greška (${err.status}).`,
          };
        }
        throw err;
      }

      revalidatePath(`/admin/narudzbine/${id}`);
      revalidatePath("/admin/narudzbine");
      return {
        ok: true as const,
        entityId: id,
        diff: {
          amount,
          paymentReference: latestPayment.paymentReference,
        },
        message:
          amount < total
            ? "Delimičan IPS povraćaj je izvršen."
            : "IPS povraćaj je izvršen.",
      };
    },
  )(formData);
}

export default async function OrderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: true,
      events: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
      paymentRefunds: { orderBy: { createdAt: "desc" } },
      shipments: { include: { events: { orderBy: { occurredAt: "desc" } } } },
      invoices: true,
      fiscal: true,
      fiscalDocuments: {
        where: { kind: "SALE", status: "ISSUED" },
        orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
        select: { id: true, receiptNumber: true, issuedAt: true, emailedAt: true, emailError: true },
      },
      reclamations: { select: { id: true, number: true, status: true } },
    },
  });
  if (!order) notFound();
  const activeSmallProvider =
    getSmallParcelProvider() === "MYGLS" ? MYGLS_PROVIDER : X_EXPRESS_PROVIDER;
  const latestIpsPayment =
    order.payments.find((payment) => payment.provider === "IPS") ?? null;
  const reservedRefundTotal = order.paymentRefunds
    .filter((refund) => ["PENDING", "COMPLETED", "NEEDS_REVIEW"].includes(refund.status))
    .reduce((sum, refund) => sum + num(refund.amount), 0);
  const refundableIpsAmount = Math.max(
    0,
    num(latestIpsPayment?.amount ?? order.total) - reservedRefundTotal,
  );
  const canRefundIps =
    order.paymentMethod === "IPS" &&
    latestIpsPayment != null &&
    ["PAID", "PARTIAL_REFUND"].includes(latestIpsPayment.status) &&
    refundableIpsAmount > 0;
  const refundRequestId = randomUUID();
  const buyerReceipt =
    order.invoices.find((invoice) => invoice.kind === "PROFORMA") ?? null;
  const latestFiscal = order.fiscalDocuments[0] ?? null;

  return (
    <>
      <PageHeader
        title={`Narudžbina ${order.number}`}
        description={`${order.shipFirstName} ${order.shipLastName} · ${order.shipCity}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/narudzbine", label: "Narudžbine" },
          { label: order.number },
        ]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardTitle>Stavke</CardTitle>
            <DataTable
              columns={[
                { key: "sku", label: "SKU" },
                { key: "name", label: "Naziv" },
                { key: "qty", label: "Kol", align: "right" },
                { key: "price", label: "Cena", align: "right" },
                { key: "subtotal", label: "Ukupno", align: "right" },
              ]}
              rows={order.items.map((it) => ({
                id: it.id,
                cells: {
                  sku: <span className="font-mono text-xs">{it.sku}</span>,
                  name: it.name,
                  qty: it.qty,
                  price: formatRsd(num(it.unitPriceSale)),
                  subtotal: formatRsd(num(it.unitPriceSale) * it.qty),
                },
              }))}
              empty="Bez stavki."
            />
          </Card>

          <Card>
            <CardTitle>Adresa isporuke</CardTitle>
            <p className="text-sm text-ink-700">
              {order.shipFirstName} {order.shipLastName}
              <br />
              {order.shipStreet}
              <br />
              {order.shipPostalCode} {order.shipCity}
              <br />
              {order.shipPhone}
            </p>
          </Card>

          <Card>
            <CardTitle>Status timeline</CardTitle>
            <ul className="space-y-2 text-sm">
              {order.events.map((e) => (
                <li key={e.id} className="flex gap-3 text-ink-700">
                  <span className="font-mono text-xs text-ink-500">
                    {e.createdAt.toLocaleString("sr-Latn-RS")}
                  </span>
                  <span className="font-medium">{e.status}</span>
                  {e.note ? <span className="text-ink-500">— {e.note}</span> : null}
                </li>
              ))}
              {order.events.length === 0 ? (
                <li className="text-sm text-ink-500">Bez događaja.</li>
              ) : null}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardTitle>Iznos</CardTitle>
            <dl className="space-y-1 text-sm">
              <Row k="Subtotal" v={formatRsd(num(order.subtotal))} />
              <Row k="Ušteda" v={`− ${formatRsd(num(order.savings))}`} />
              <Row k="Dostava" v={formatRsd(num(order.shipping))} />
              <Row k="Montaža" v={formatRsd(num(order.assemblyTotal))} />
              {order.voucherCode ? (
                <Row
                  k={`Vaučer ${order.voucherCode}`}
                  v={`− ${formatRsd(num(order.voucherDiscount))}`}
                />
              ) : null}
              <Row k="Ukupno" v={<strong>{formatRsd(num(order.total))}</strong>} />
            </dl>
          </Card>

          <Card>
            <CardTitle>Promena statusa</CardTitle>
            <AdminActionForm action={updateStatus} className="space-y-3">
              <input type="hidden" name="id" value={order.id} />
              <Field label="Novi status">
                <select
                  key={order.status}
                  name="status"
                  defaultValue={order.status}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  {Object.values(OrderStatus).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Napomena">
                <Textarea name="note" rows={2} />
              </Field>
              <div className="flex justify-end">
                <SubmitButton size="sm">Sačuvaj</SubmitButton>
              </div>
            </AdminActionForm>
          </Card>

          {order.paymentMethod === "IPS" ? (
            <Card>
              <CardTitle
                description={
                  latestIpsPayment?.paymentReference
                    ? `RP ${latestIpsPayment.paymentReference}`
                    : "IPS transakcija"
                }
              >
                IPS povraćaj
              </CardTitle>
              <dl className="mb-3 space-y-1 text-sm">
                <Row k="Status plaćanja" v={latestIpsPayment?.status ?? "—"} />
                <Row
                  k="RP referenca"
                  v={
                    <span className="font-mono text-xs">
                      {latestIpsPayment?.paymentReference ?? "—"}
                    </span>
                  }
                />
                <Row k="Ukupno" v={formatRsd(num(order.total))} />
                <Row k="Preostalo za povraćaj" v={formatRsd(refundableIpsAmount)} />
              </dl>
              {order.paymentRefunds.length ? (
                <ul className="mb-4 space-y-2 text-xs">
                  {order.paymentRefunds.map((refund) => (
                    <li key={refund.id} className="rounded-lg border border-border p-2">
                      <span className="font-mono">{refund.status}</span> · {formatRsd(num(refund.amount))}
                      {refund.status === "NEEDS_REVIEW" ? " · ručno usaglašavanje obavezno" : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              {canRefundIps ? (
                <AdminActionForm action={refundIpsPaymentAction} className="space-y-3">
                  <input type="hidden" name="id" value={order.id} />
                  <input type="hidden" name="refundRequestId" value={refundRequestId} />
                  <Field
                    label="Iznos za povraćaj"
                    hint="Podrazumevano je pun iznos porudžbine; unesite manji iznos za delimičan povraćaj."
                  >
                    <input
                      name="amount"
                      type="number"
                      min="0.01"
                      max={refundableIpsAmount.toFixed(2)}
                      step="0.01"
                      defaultValue={refundableIpsAmount.toFixed(2)}
                      className="h-8 w-full rounded-lg border border-input bg-transparent px-2 font-mono text-sm"
                    />
                  </Field>
                  <div className="flex justify-end">
                    <SubmitButton variant="destructive" size="sm">
                      Izvrši IPS povraćaj
                    </SubmitButton>
                  </div>
                </AdminActionForm>
              ) : (
                <p className="text-sm text-ink-500">
                  Povraćaj je dostupan samo za potvrđenu IPS uplatu sa preostalim iznosom.
                </p>
              )}
            </Card>
          ) : null}

          <Card>
            <CardTitle
              description={
                order.shippingMethod === "KURIR"
                  ? "Kurirski nalog i statusi"
                  : "Nije kurirska isporuka"
              }
            >
              Kurir
            </CardTitle>
            {order.shippingMethod !== "KURIR" ? (
              <p className="text-sm text-ink-500">
                Kamionska isporuka se ne šalje kroz kurira za male pošiljke.
              </p>
            ) : (
              <div className="space-y-3 text-sm">
                {order.shipments.length ? (
                  <ul className="space-y-3">
                    {order.shipments.map((shipment) => (
                      <li key={shipment.id} className="rounded-lg border border-border p-3">
                        <dl className="space-y-1 text-ink-700">
                          <Row k="Provider" v={shipment.provider ?? "—"} />
                          <Row
                            k="Tracking"
                            v={
                              <span className="font-mono text-xs">
                                {shipment.trackingNo ?? "—"}
                              </span>
                            }
                          />
                          <Row k="Status" v={shipment.status} />
                          <Row k="Kurir status" v={shipment.providerStatusCode ?? "—"} />
                          <Row k="Paketa" v={shipment.packageCount} />
                          {shipment.providerRouteCode || shipment.providerRouteName ? (
                            <Row
                              k="Reon"
                              v={[shipment.providerRouteCode, shipment.providerRouteName]
                                .filter(Boolean)
                                .join(" · ")}
                            />
                          ) : null}
                          {shipment.providerParcelId ? (
                            <Row
                              k="Parcel ID"
                              v={<span className="font-mono text-xs">{shipment.providerParcelId}</span>}
                            />
                          ) : null}
                          {Array.isArray(shipment.providerParcelNumbers) &&
                          shipment.providerParcelNumbers.length ? (
                            <Row
                              k="Parcel brojevi"
                              v={
                                <span className="font-mono text-xs">
                                  {shipment.providerParcelNumbers.join(", ")}
                                </span>
                              }
                            />
                          ) : null}
                          <Row
                            k="Sync"
                            v={
                              shipment.lastStatusSyncAt
                                ? shipment.lastStatusSyncAt.toLocaleString("sr-Latn-RS")
                                : "—"
                            }
                          />
                          {shipment.providerOrderId ? (
                            <Row
                              k="Nalog"
                              v={<span className="font-mono text-xs">{shipment.providerOrderId}</span>}
                            />
                          ) : null}
                          {shipment.labelUrl ? (
                            <Row
                              k="Etiketa"
                              v={
                                <a
                                  href={shipment.labelUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-walnut underline"
                                >
                                  Otvori
                                </a>
                              }
                            />
                          ) : null}
                        </dl>
                        {shipment.syncError ? (
                          <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">
                            {shipment.syncError}
                          </p>
                        ) : null}
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          {shipment.provider && shipment.trackingNo ? (
                            <AdminActionForm action={syncCourierShipment}>
                              <input type="hidden" name="shipmentId" value={shipment.id} />
                              <input type="hidden" name="orderId" value={order.id} />
                              <SubmitButton variant="outline" size="xs">
                                Osveži status
                              </SubmitButton>
                            </AdminActionForm>
                          ) : null}
                          {shipment.provider === MYGLS_PROVIDER &&
                          shipment.status !== "DELIVERED" &&
                          shipment.status !== "RETURNED" ? (
                            <>
                              <AdminActionForm action={modifyMyGlsCOD} className="flex items-center gap-2">
                                <input type="hidden" name="shipmentId" value={shipment.id} />
                                <input type="hidden" name="orderId" value={order.id} />
                                <input
                                  name="codAmount"
                                  type="number"
                                  min={0}
                                  defaultValue={num(order.total)}
                                  className="h-7 w-24 rounded-md border border-input bg-transparent px-2 text-xs"
                                />
                                <SubmitButton variant="outline" size="xs">
                                  Izmeni COD
                                </SubmitButton>
                              </AdminActionForm>
                              <AdminActionForm action={deleteMyGlsShipment}>
                                <input type="hidden" name="shipmentId" value={shipment.id} />
                                <input type="hidden" name="orderId" value={order.id} />
                                <SubmitButton variant="destructive" size="xs">
                                  Obriši GLS
                                </SubmitButton>
                              </AdminActionForm>
                            </>
                          ) : null}
                          {shipment.status === "FAILED" ? (
                            <AdminActionForm action={createCourierShipment} className="flex items-end gap-2">
                              <input type="hidden" name="id" value={order.id} />
                              {shipment.provider === X_EXPRESS_PROVIDER ? (
                                <Field label="Paketa">
                                  <input
                                    name="packageCount"
                                    type="number"
                                    min={1}
                                    max={99}
                                    defaultValue={shipment.packageCount || 1}
                                    className="h-7 w-20 rounded-md border border-input bg-transparent px-2 text-xs"
                                  />
                                </Field>
                              ) : null}
                              <SubmitButton size="xs">Ponovi nalog</SubmitButton>
                            </AdminActionForm>
                          ) : null}
                        </div>
                        {shipment.events.length ? (
                          <details className="mt-3 text-xs text-ink-600">
                            <summary className="cursor-pointer">
                              Događaji ({shipment.events.length})
                            </summary>
                            <ul className="mt-2 space-y-1">
                              {shipment.events.map((event) => (
                                <li key={event.id}>
                                  {event.occurredAt.toLocaleString("sr-Latn-RS")} ·{" "}
                                  {event.status}
                                  {event.message ? ` · ${event.message}` : ""}
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-500">Kurirski nalog još nije kreiran.</p>
                )}
                {order.shipments.every(
                  (shipment) =>
                    shipment.provider !== activeSmallProvider || shipment.status === "FAILED",
                ) ? (
                    <AdminActionForm action={createCourierShipment} className="flex items-end justify-end gap-2">
                      <input type="hidden" name="id" value={order.id} />
                      {activeSmallProvider === X_EXPRESS_PROVIDER ? (
                        <Field label="Paketa">
                          <input
                            name="packageCount"
                            type="number"
                            min={1}
                            max={99}
                            defaultValue={Math.max(1, order.items.reduce((sum, item) => sum + item.qty, 0))}
                            className="h-8 w-20 rounded-lg border border-input bg-transparent px-2 text-sm"
                          />
                        </Field>
                      ) : null}
                      <SubmitButton size="sm">
                        Kreiraj {activeSmallProvider === MYGLS_PROVIDER ? "MyGLS" : "X Express"} nalog
                      </SubmitButton>
                  </AdminActionForm>
                ) : null}
              </div>
            )}
          </Card>

          <Card>
            <CardTitle description={buyerReceipt?.number ?? "Nije izdat"}>
              Predračun / račun za kupca
            </CardTitle>
            {buyerReceipt ? (
              <dl className="mb-4 space-y-1 text-sm">
                <Row k="Status" v={buyerReceipt.status} />
                <Row
                  k="Poslato"
                  v={buyerReceipt.emailedAt ? buyerReceipt.emailedAt.toLocaleString("sr-Latn-RS") : "—"}
                />
                <Row k="Primalac" v={buyerReceipt.recipientEmail ?? "—"} />
              </dl>
            ) : (
              <p className="mb-4 text-sm text-ink-500">
                Predračun se automatski izdaje nakon kupovine. Ako ga nema,
                regenerišite ga ručno.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {buyerReceipt ? (
                <a
                  href={`/api/admin/invoices/${buyerReceipt.id}/pdf`}
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted"
                >
                  Preuzmi PDF
                </a>
              ) : null}
              <AdminActionForm action={resendBuyerReceiptAction}>
                <input type="hidden" name="id" value={order.id} />
                <SubmitButton size="sm">
                  {buyerReceipt ? "Ponovo pošalji" : "Izdaj i pošalji"}
                </SubmitButton>
              </AdminActionForm>
            </div>
          </Card>

          <Card>
            <CardTitle description={latestFiscal?.receiptNumber ?? order.fiscal?.receiptNumber ?? "Nije fiskalizovano"}>
              Fiskalizacija
            </CardTitle>
            <AdminActionForm action={issueFiscalReceiptAction} className="mb-4">
              <input type="hidden" name="id" value={order.id} />
              <SubmitButton size="sm">
                {latestFiscal ? "Ponovo pošalji fiskalni račun" : "Izdaj fiskalni račun"}
              </SubmitButton>
            </AdminActionForm>
            {order.fiscalDocuments.length ? (
              <dl className="mb-4 space-y-1 text-sm">
                <Row k="Broj dokumenata" v={order.fiscalDocuments.length} />
                <Row
                  k="Poslato"
                  v={latestFiscal?.emailedAt ? latestFiscal.emailedAt.toLocaleString("sr-Latn-RS") : "—"}
                />
                <Row k="Email greška" v={latestFiscal?.emailError ?? "—"} />
              </dl>
            ) : null}
            <AdminActionForm action={markFiscalized} className="space-y-2">
              <input type="hidden" name="id" value={order.id} />
              <Field label="Broj fiskalnog računa">
                <input
                  name="receiptNumber"
                  defaultValue={latestFiscal?.receiptNumber ?? order.fiscal?.receiptNumber ?? ""}
                  required
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 font-mono text-sm"
                />
              </Field>
              <div className="flex justify-end">
                <SubmitButton size="sm">Sačuvaj</SubmitButton>
              </div>
            </AdminActionForm>
          </Card>

          {order.reclamations.length > 0 ? (
            <Card>
              <CardTitle>Reklamacije</CardTitle>
              <ul className="space-y-1 text-sm">
                {order.reclamations.map((r) => (
                  <li key={r.id}>
                    <span className="font-mono text-xs">{r.number}</span> · {r.status}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function smallParcelAutoCreateEnabled() {
  return getSmallParcelProvider() === "MYGLS"
    ? getMyGlsConfig().autoCreate
    : getXExpressConfig().autoCreate;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between text-ink-700">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
