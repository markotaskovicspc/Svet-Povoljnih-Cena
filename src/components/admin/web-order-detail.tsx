import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import {
  OrderStatus,
  PaymentMethod,
  Prisma,
  type SupplierFulfillmentStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueBackgroundJob, processBackgroundJob } from "@/lib/background-jobs";
import { withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import {
  createShipmentForOrder,
  syncCourierShipmentById,
} from "@/lib/courier";
import { resolveCourierProvider } from "@/lib/courier/routing";
import { derivePhysicalPackages } from "@/lib/courier/packages";
import {
  normalizeOrderItemIds,
  readShipmentAssignment,
} from "@/lib/courier/shipment-assignment";
import { issueAndDeliverFiscalReceipt } from "@/lib/fiscal";
import { issueBuyerReceiptForOrder } from "@/lib/receipts";
import { ipsPaymentProvider, IpsConfigError, IpsGatewayError } from "@/lib/payments";
import { getXExpressConfig, X_EXPRESS_PROVIDER } from "@/lib/x-express/config";
import { announceXExpressShipment } from "@/lib/x-express/shipments";
import {
  deleteMyGlsLabelsForShipment,
  getMyGlsConfig,
  modifyMyGlsCODForShipment,
  MYGLS_PROVIDER,
} from "@/lib/mygls";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import {
  enqueueSupplierShippingDocumentJobsForOrder,
  releaseOrderSupplierReservations,
} from "@/lib/rabalux/fulfillment";
import {
  addWebOrderItem,
  updateWebOrderItemQuantity,
} from "@/lib/admin/web-order-edit.server";
import { updateWebOrderPaymentMethod } from "@/lib/admin/web-order-payment.server";
import {
  EDITABLE_WEB_ORDER_PAYMENT_METHODS,
  planWebOrderPaymentMethodChange,
} from "@/lib/admin/web-order-payment";
import { updateWebOrderShippingContact } from "@/lib/admin/web-order-shipping.server";
import {
  planWebOrderShippingEdit,
  shippingEditPickupBatchBlockReason,
  shippingEditWaybillQuestion,
  type WebOrderShippingEditPlan,
} from "@/lib/admin/web-order-shipping";
import {
  canConfirmSupplierFulfillment,
  canResendSupplierOrder,
} from "@/lib/rabalux/fulfillment-state";
import { isRabaluxSupplierOperational } from "@/lib/rabalux/config";
import { restoreOrderReservations } from "@/lib/order-reservations";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/admin/data-table";
import { AdminActionForm } from "@/components/admin/action-form";
import {
  fulfillmentPaymentReadiness,
  isCashOnDeliveryPaymentMethod,
} from "@/lib/payments/fulfillment-readiness";
import {
  clientPaymentMethodToDb,
  getCheckoutPaymentMethods,
} from "@/lib/checkout/config";
import { adminPaymentMethodLabel } from "@/lib/payments/admin-display";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Narudžbina",
  robots: { index: false, follow: false },
};

async function updateWebOrderItemQuantityAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "order.webItemUpdate", entity: "OrderItem" },
    async (actorId, formData: FormData) => {
      const orderId = String(formData.get("orderId") ?? "");
      const orderItemId = String(formData.get("orderItemId") ?? "");
      const rawQty = String(formData.get("newQty") ?? "").trim();
      if (!orderId || !orderItemId || !/^\d+$/.test(rawQty)) {
        return {
          ok: false as const,
          error: "Unesite ispravnu novu količinu.",
        };
      }
      const result = await updateWebOrderItemQuantity({
        orderId,
        orderItemId,
        newQty: Number(rawQty),
        actorId,
      });
      revalidatePath(`/admin/erp/prodajni-nalozi/${orderId}`);
      revalidatePath("/admin/erp/prodajni-nalozi");
      return {
        ok: true as const,
        entityId: orderItemId,
        diff: {
          orderId,
          sku: result.sku,
          previousQty: result.previousQty,
          newQty: result.newQty,
          totals: result.totals,
          receiptRefreshed: result.receiptRefreshed,
          receiptError: result.receiptError,
          customerNotificationQueued: result.customerNotificationQueued,
        },
        message: result.receiptRefreshed
          ? `Stavka ${result.sku} je promenjena (${result.previousQty} → ${result.newQty}); rezervacije, iznosi i predračun su osveženi, a obaveštenje kupcu je zakazano.`
          : `Stavka ${result.sku} je promenjena i obaveštenje kupcu je zakazano, ali predračun nije osvežen (${result.receiptError ?? "nepoznata greška"}). Ne ponavljajte izmenu; regenerišite dokument ručno.`,
      };
    },
  )(formData);
}

async function addWebOrderItemAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "order.webItemAdd", entity: "OrderItem" },
    async (actorId, formData: FormData) => {
      const orderId = String(formData.get("orderId") ?? "");
      const sku = String(formData.get("sku") ?? "").trim();
      const rawQty = String(formData.get("qty") ?? "").trim();
      if (
        !orderId ||
        !sku ||
        sku.length > 100 ||
        !/^\d+$/.test(rawQty) ||
        Number(rawQty) < 1 ||
        Number(rawQty) > 999
      ) {
        return {
          ok: false as const,
          error: "Unesite ispravnu šifru i količinu od 1 do 999.",
        };
      }
      const result = await addWebOrderItem({
        orderId,
        sku,
        qty: Number(rawQty),
        actorId,
      });
      revalidatePath(`/admin/erp/prodajni-nalozi/${orderId}`);
      revalidatePath("/admin/erp/prodajni-nalozi");
      const change =
        result.previousQty > 0
          ? `Količina artikla ${result.sku} je povećana (${result.previousQty} → ${result.newQty})`
          : `Artikal ${result.sku} je dodat u količini ${result.newQty}`;
      return {
        ok: true as const,
        entityId: result.itemId,
        diff: {
          orderId,
          sku: result.sku,
          previousQty: result.previousQty,
          newQty: result.newQty,
          totals: result.totals,
          receiptRefreshed: result.receiptRefreshed,
          receiptError: result.receiptError,
          customerNotificationQueued: result.customerNotificationQueued,
        },
        tone: result.receiptRefreshed
          ? ("success" as const)
          : ("warning" as const),
        message: result.receiptRefreshed
          ? `${change}; rezervacije, iznosi i predračun su osveženi, a obaveštenje kupcu je zakazano.`
          : `${change} i obaveštenje kupcu je zakazano, ali predračun nije osvežen (${result.receiptError ?? "nepoznata greška"}). Ne ponavljajte izmenu; regenerišite dokument ručno.`,
      };
    },
  )(formData);
}

async function updateWebOrderPaymentMethodAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    {
      allowed: ["OPS"],
      action: "order.webPaymentMethodUpdate",
      entity: "Payment",
    },
    async (actorId, formData: FormData) => {
      const orderId = String(formData.get("orderId") ?? "");
      const rawMethod = String(formData.get("paymentMethod") ?? "");
      if (
        !orderId ||
        !Object.values(PaymentMethod).includes(rawMethod as PaymentMethod)
      ) {
        return {
          ok: false as const,
          error: "Izaberite ispravan način plaćanja.",
        };
      }
      const result = await updateWebOrderPaymentMethod({
        orderId,
        nextMethod: rawMethod as PaymentMethod,
        actorId,
      });
      revalidatePath(`/admin/erp/prodajni-nalozi/${orderId}`);
      revalidatePath("/admin/erp/prodajni-nalozi");
      const previousLabel = adminPaymentMethodLabel(result.previousMethod);
      const nextLabel = adminPaymentMethodLabel(result.nextMethod);
      const supplierMessage = result.supplierJobsQueued
        ? " Dobavljački tok je usklađen sa novim načinom plaćanja."
        : "";
      return {
        ok: true as const,
        entityId: result.paymentId,
        diff: {
          orderId,
          previousMethod: result.previousMethod,
          nextMethod: result.nextMethod,
          invalidatedPaymentAttempts: result.invalidatedPaymentAttempts,
          supplierJobsQueued: result.supplierJobsQueued,
          receiptRefreshed: result.receiptRefreshed,
          receiptError: result.receiptError,
        },
        tone: result.receiptRefreshed
          ? ("success" as const)
          : ("warning" as const),
        message: result.receiptRefreshed
          ? `Način plaćanja je promenjen: ${previousLabel} → ${nextLabel}. Predračun je osvežen, ali nije automatski poslat kupcu.${supplierMessage}`
          : `Način plaćanja je promenjen: ${previousLabel} → ${nextLabel}, ali predračun nije osvežen (${result.receiptError ?? "nepoznata greška"}). Regenerišite ga ručno.${supplierMessage}`,
      };
    },
  )(formData);
}

async function updateShippingAddressAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "order.shippingAddressUpdate", entity: "Order" },
    async (actorId, formData: FormData) => {
      const orderId = String(formData.get("orderId") ?? "");
      const result = await updateWebOrderShippingContact({
        orderId,
        actorId,
        expectedUpdatedAt: String(formData.get("expectedUpdatedAt") ?? ""),
        mode: "ADDRESS",
        address: {
          street: formData.get("street"),
          city: formData.get("city"),
          postalCode: formData.get("postalCode"),
        },
        replaceWaybills: formData.get("replaceWaybills") === "yes",
        confirmXExpressCancellation:
          formData.get("confirmXExpressCancellation") === "yes",
        clearDeliveryPoint: formData.get("clearDeliveryPoint") === "yes",
      });
      revalidatePath(`/admin/erp/prodajni-nalozi/${orderId}`);
      revalidatePath("/admin/erp/prodajni-nalozi");
      return shippingContactActionResult(result, "Adresa isporuke je izmenjena.");
    },
  )(formData);
}

async function updateShippingPhoneAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "order.shippingPhoneUpdate", entity: "Order" },
    async (actorId, formData: FormData) => {
      const orderId = String(formData.get("orderId") ?? "");
      const result = await updateWebOrderShippingContact({
        orderId,
        actorId,
        expectedUpdatedAt: String(formData.get("expectedUpdatedAt") ?? ""),
        mode: "PHONE",
        phone: formData.get("phone"),
        replaceWaybills: formData.get("replaceWaybills") === "yes",
        confirmXExpressCancellation:
          formData.get("confirmXExpressCancellation") === "yes",
        clearDeliveryPoint: false,
      });
      revalidatePath(`/admin/erp/prodajni-nalozi/${orderId}`);
      revalidatePath("/admin/erp/prodajni-nalozi");
      return shippingContactActionResult(
        result,
        "Broj telefona za isporuku je izmenjen.",
      );
    },
  )(formData);
}

function shippingContactActionResult(
  result: Awaited<ReturnType<typeof updateWebOrderShippingContact>>,
  successMessage: string,
) {
  const details = [successMessage];
  if (result.replacedWaybills > 0) {
    details.push(
      result.replacedWaybills === 1
        ? "Stara adresnica je poništena i napravljena je nova."
        : `Poništene su stare adresnice i napravljeno je ${result.replacedWaybills} novih.`,
    );
  }
  if (result.replacementErrors.length) {
    details.push(
      `PAŽNJA: nova adresnica nije napravljena (${result.replacementErrors.join(
        "; ",
      )}). Nemojte koristiti staru adresnicu; napravite novu iz kurirske sekcije.`,
    );
  }
  if (result.receiptRefreshed) {
    details.push("Predračun je osvežen, ali nije automatski poslat kupcu.");
  } else if (result.receiptError) {
    details.push(
      `PAŽNJA: predračun nije osvežen (${result.receiptError}). Regenerišite ga ručno.`,
    );
  }
  return {
    ok: true as const,
    entityId: result.orderId,
    diff: {
      mode: result.mode,
      previous: result.previous,
      next: result.next,
      replacedWaybills: result.replacedWaybills,
      replacementErrors: result.replacementErrors,
      receiptRefreshed: result.receiptRefreshed,
      receiptError: result.receiptError,
    },
    tone:
      result.replacementErrors.length || result.receiptError
        ? ("warning" as const)
        : ("success" as const),
    message: details.join(" "),
  };
}

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
        const supplierCancellations: string[] = [];
        await db.$transaction(async (tx) => {
          const existing = await tx.order.findUnique({
            where: { id },
            select: {
              number: true,
              stockRestoredAt: true,
              items: {
                select: {
                  id: true,
                  productId: true,
                  qty: true,
                  sku: true,
                  warehouseReservedQty: true,
                  warehouseDispatchedQty: true,
                  supplierReservedQty: true,
                },
              },
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
            const restored = await restoreOrderReservations(tx, {
              orderId: id,
              orderNumber: existing.number,
              items: existing.items,
              reasonKey: "cancel",
              actorId,
              note: `Otkazivanje porudžbine ${existing.number}`,
            });
            supplierCancellations.push(...restored.supplierCancellationIds);
          } else if (status === "U_ISPORUCI" || status === "ISPORUCENO") {
            await releaseOrderSupplierReservations(tx, id, {
              cancelled: false,
            });
          }
          await tx.orderStatusEvent.create({
            data: { orderId: id, status, note, actorId },
          });
        });
        await Promise.all(
          supplierCancellations.map((fulfillmentId) =>
            enqueueBackgroundJob({
              kind: "SUPPLIER_CANCEL_EMAIL",
              payload: { fulfillmentId },
              idempotencyKey: `supplier-cancel:${fulfillmentId}`,
            }),
          ),
        );
        await enqueueBackgroundJob({
          kind: "ORDER_STATUS_EMAIL",
          payload: { orderId: id, status },
          idempotencyKey: `order-status-email:${id}:${status}`,
        });
        let courierDeferredForPayment = false;
        if (
          status === "SPREMNO_ZA_ISPORUKU" &&
          (await smallParcelAutoCreateEnabled())
        ) {
          const paymentState = await db.order.findUnique({
            where: { id },
            select: {
              paymentMethod: true,
              payments: { select: { status: true } },
            },
          });
          const readiness = paymentState
            ? fulfillmentPaymentReadiness({
                purpose: "ORDER_DELIVERY",
                paymentMethod: paymentState.paymentMethod,
                paymentStatuses: paymentState.payments.map(
                  (payment) => payment.status,
                ),
              })
            : { ready: false as const, reason: "Porudžbina ne postoji." };
          if (readiness.ready) {
            await createShipmentForOrder(id);
          } else {
            courierDeferredForPayment = true;
          }
        }
        revalidatePath(`/admin/erp/prodajni-nalozi/${id}`);
        revalidatePath("/admin/erp/prodajni-nalozi");
        return {
          ok: true as const,
          entityId: id,
          diff: { status, note },
          message: courierDeferredForPayment
            ? "Status porudžbine je ažuriran, ali kurirski nalog nije kreiran jer plaćanje još nije potvrđeno."
            : "Status porudžbine je ažuriran.",
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
      const providerValue = String(formData.get("provider") ?? "").trim();
      const provider =
        providerValue === MYGLS_PROVIDER
          ? "MYGLS"
          : providerValue === X_EXPRESS_PROVIDER
            ? "X_EXPRESS"
            : null;
      const orderItemIds = normalizeOrderItemIds(
        formData.getAll("orderItemIds").map(String),
      );
      const packageCount = Math.max(
        1,
        Math.min(99, Number(formData.get("packageCount") ?? 1) || 1),
      );
      if (!id) return { ok: false as const, error: "Nedostaje ID porudžbine." };
      if (!provider || !orderItemIds.length) {
        return {
          ok: false as const,
          error: "Izaberite kurira i najmanje jednu stavku porudžbine.",
        };
      }
      const order = await db.order.findUnique({
        where: { id },
        select: {
          total: true,
          paymentMethod: true,
          items: {
            select: { id: true, qty: true, unitPriceSale: true },
          },
          shipments: {
            where: { purpose: "ORDER_DELIVERY", status: { not: "FAILED" } },
            select: { rawCreateResponse: true },
          },
        },
      });
      if (!order) return { ok: false as const, error: "Porudžbina ne postoji." };
      const requestedItems = order.items.filter((item) =>
        orderItemIds.includes(item.id),
      );
      if (requestedItems.length !== orderItemIds.length) {
        return {
          ok: false as const,
          error: "Jedna od izabranih stavki ne pripada porudžbini.",
        };
      }
      const allOrderItemIds = order.items.map((item) => item.id);
      const assignedIds = new Set<string>();
      let existingCodAmount = 0;
      for (const shipment of order.shipments) {
        const assignment = readShipmentAssignment(shipment.rawCreateResponse);
        for (const itemId of assignment?.orderItemIds ?? allOrderItemIds) {
          assignedIds.add(itemId);
        }
        existingCodAmount += assignment?.codAmount ?? Number(order.total);
      }
      const alreadyAssigned = orderItemIds.find((itemId) => assignedIds.has(itemId));
      if (alreadyAssigned) {
        return {
          ok: false as const,
          error: "Jedna od izabranih stavki već ima aktivan kurirski nalog.",
        };
      }
      const remainingIds = allOrderItemIds.filter((itemId) => !assignedIds.has(itemId));
      const itemValue = (items: typeof order.items) =>
        items.reduce(
          (sum, item) => sum + num(item.unitPriceSale) * item.qty,
          0,
        );
      const cashOnDelivery =
        order.paymentMethod === "POUZECE_GOTOVINA" ||
        order.paymentMethod === "POUZECE_KARTICA";
      const selectedIsRemainder =
        orderItemIds.length === remainingIds.length &&
        orderItemIds.every((itemId) => remainingIds.includes(itemId));
      const merchandiseValue = itemValue(order.items);
      const proportionalCod =
        merchandiseValue > 0
          ? Math.round(
              (Number(order.total) * itemValue(requestedItems) * 100) /
                merchandiseValue,
            ) / 100
          : 0;
      const codAmount = cashOnDelivery
        ? Math.max(
            0,
            Math.min(
              Number(order.total) - existingCodAmount,
              selectedIsRemainder
                ? Number(order.total) - existingCodAmount
                : proportionalCod,
            ),
          )
        : 0;
      // createShipmentForOrder throws on failure but still persists a FAILED
      // shipment row — revalidate in `finally` so that row is visible without a
      // hard reload, and surface the error instead of swallowing it (Bug #10).
      try {
        const shipment = await createShipmentForOrder(id, {
          packageCount,
          provider,
          orderItemIds,
          codAmount,
        });
        return {
          ok: true as const,
          entityId: shipment.id,
          diff: { provider: shipment.provider, trackingNo: shipment.trackingNo },
          message:
            shipment.provider === X_EXPRESS_PROVIDER
              ? `X Express nalog je automatski poslat za ${orderItemIds.length} stavki (${shipment.trackingNo ?? "bez koda"}), a adresnica je spremna za štampu.`
              : `Kurirski nalog je kreiran za ${orderItemIds.length} stavki (${shipment.provider}${
                  shipment.trackingNo ? ` · ${shipment.trackingNo}` : ""
                }).`,
        };
      } finally {
        revalidatePath(`/admin/erp/prodajni-nalozi/${id}`);
        revalidatePath("/admin/erp/prodajni-nalozi");
      }
    },
  )(formData);
}

async function announceXExpressCourierShipment(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "order.xExpressAnnounce", entity: "Shipment" },
    async (_actorId, formData: FormData) => {
      const shipmentId = String(formData.get("shipmentId") ?? "");
      const orderId = String(formData.get("orderId") ?? "");
      if (!shipmentId || !orderId) {
        return { ok: false as const, error: "Nedostaje ID X Express pošiljke." };
      }
      try {
        const shipment = await announceXExpressShipment(shipmentId);
        return {
          ok: true as const,
          entityId: shipment.id,
          diff: { providerShipmentId: shipment.providerShipmentId },
          message: "X Express je prihvatio pošiljku.",
        };
      } finally {
        revalidatePath(`/admin/erp/prodajni-nalozi/${orderId}`);
        revalidatePath("/admin/erp/prodajni-nalozi");
      }
    },
  )(formData);
}

async function confirmBankTransferPaymentAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "order.bankTransferConfirm", entity: "Payment" },
    async (actorId, formData: FormData) => {
      const orderId = String(formData.get("orderId") ?? "");
      const paymentId = String(formData.get("paymentId") ?? "");
      const paidOn = String(formData.get("paidOn") ?? "").trim();
      const statementReference = String(
        formData.get("statementReference") ?? "",
      ).trim();
      const note = String(formData.get("note") ?? "").trim();
      if (!orderId || !paymentId || !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) {
        return {
          ok: false as const,
          error: "Izaberite datum kada je uplata stvarno legla na račun.",
        };
      }
      if (!statementReference) {
        return {
          ok: false as const,
          error: "Unesite poziv na broj ili referencu izvoda.",
        };
      }
      const paidAt = new Date(`${paidOn}T12:00:00`);
      if (
        Number.isNaN(paidAt.getTime()) ||
        paidAt.getTime() > Date.now() + 24 * 60 * 60_000
      ) {
        return { ok: false as const, error: "Datum uplate nije ispravan." };
      }

      const result = await db.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "Order"
          WHERE "id" = ${orderId}
          FOR UPDATE
        `);
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            number: true,
            status: true,
            paymentMethod: true,
            cancelledAt: true,
          },
        });
        if (!order || order.paymentMethod !== "UPLATA_NA_RACUN") {
          throw new Error("Porudžbina sa uplatom na račun nije pronađena.");
        }
        if (order.cancelledAt || order.status === "OTKAZANO") {
          throw new Error("Uplata se ne potvrđuje na otkazanoj porudžbini.");
        }
        const payment = await tx.payment.findFirst({
          where: {
            id: paymentId,
            orderId,
            method: "UPLATA_NA_RACUN",
            provider: "MANUAL",
          },
          select: { id: true, status: true, amount: true, currency: true },
        });
        if (!payment) throw new Error("Evidencija uplate nije pronađena.");
        if (payment.status !== "PENDING") {
          throw new Error(
            payment.status === "PAID"
              ? "Ova uplata je već potvrđena."
              : `Uplata je u statusu ${payment.status} i ne može ručno da se potvrdi.`,
          );
        }
        const updated = await tx.payment.updateMany({
          where: { id: payment.id, status: "PENDING" },
          data: {
            status: "PAID",
            paidAt,
            providerRef: statementReference.slice(0, 180),
          },
        });
        if (updated.count !== 1) {
          throw new Error("Status uplate je u međuvremenu promenjen. Osvežite stranicu.");
        }
        const eventNote = [
          `Uplata na račun potvrđena (${payment.amount} ${payment.currency}; ref. ${statementReference.slice(0, 180)}).`,
          note ? note.slice(0, 500) : null,
        ]
          .filter(Boolean)
          .join(" ");
        await tx.orderStatusEvent.create({
          data: {
            orderId,
            status: order.status,
            actorId,
            note: eventNote,
          },
        });
        return {
          orderNumber: order.number,
          amount: Number(payment.amount),
          currency: payment.currency,
        };
      });

      const supplierJobs = await enqueueSupplierShippingDocumentJobsForOrder(
        orderId,
        `bank-paid-${paymentId}`,
      );
      await Promise.allSettled(
        supplierJobs.map((job) => processBackgroundJob(job.id)),
      );

      revalidatePath(`/admin/erp/prodajni-nalozi/${orderId}`);
      revalidatePath("/admin/erp/prodajni-nalozi");
      revalidatePath("/admin/erp/preuzimanja");
      return {
        ok: true as const,
        entityId: paymentId,
        diff: {
          orderId,
          orderNumber: result.orderNumber,
          status: "PAID",
          paidOn,
          statementReference: statementReference.slice(0, 180),
          note: note.slice(0, 500),
          amount: result.amount,
          currency: result.currency,
        },
        message:
          supplierJobs.length > 0
            ? "Uplata je potvrđena. Rabalux adresnica i dokument za pakovanje stavljeni su u obradu."
            : "Uplata je potvrđena. Porudžbina sada može da se učita u nalog za preuzimanje.",
      };
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
        revalidatePath(`/admin/erp/prodajni-nalozi/${orderId}`);
        revalidatePath("/admin/erp/prodajni-nalozi");
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
        revalidatePath(`/admin/erp/prodajni-nalozi/${orderId}`);
        revalidatePath("/admin/erp/prodajni-nalozi");
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
      const shipment = await db.shipment.findFirst({
        where: { id: shipmentId, orderId },
        select: { order: { select: { paymentMethod: true } } },
      });
      if (
        !shipment ||
        !isCashOnDeliveryPaymentMethod(shipment.order.paymentMethod)
      ) {
        return {
          ok: false as const,
          error: "COD može da se menja samo za porudžbinu koja se plaća pouzećem.",
        };
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
        revalidatePath(`/admin/erp/prodajni-nalozi/${orderId}`);
        revalidatePath("/admin/erp/prodajni-nalozi");
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
      revalidatePath(`/admin/erp/prodajni-nalozi/${id}`);
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
      revalidatePath(`/admin/erp/prodajni-nalozi/${id}`);
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

async function confirmSupplierFulfillmentAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    {
      allowed: ["OPS"],
      action: "supplierFulfillment.confirm",
      entity: "SupplierFulfillment",
    },
    async (actorId, formData: FormData) => {
      const orderId = String(formData.get("orderId") ?? "");
      const fulfillmentId = String(formData.get("fulfillmentId") ?? "");
      const loadingLocationId = String(formData.get("loadingLocationId") ?? "");
      const address = String(formData.get("address") ?? "").trim();
      const city = String(formData.get("city") ?? "").trim();
      const reason = String(formData.get("reason") ?? "").trim();
      const requestId = String(formData.get("requestId") ?? "");
      if (
        !orderId ||
        !fulfillmentId ||
        !loadingLocationId ||
        !address ||
        !city ||
        reason.length < 5 ||
        reason.length > 500 ||
        !isUuid(requestId)
      ) {
        return {
          ok: false as const,
          error:
            "Izaberite lokaciju, unesite adresu i grad, kao i razlog od 5 do 500 znakova.",
        };
      }
      await db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            supplierId: string;
            orderId: string;
            status: SupplierFulfillmentStatus;
            confirmedAt: Date | null;
          }>
        >(Prisma.sql`
          SELECT "id", "supplierId", "orderId", "status", "confirmedAt"
          FROM "SupplierFulfillment"
          WHERE "id" = ${fulfillmentId}
          FOR UPDATE
        `);
        const fulfillment = rows[0];
        const location = await tx.supplierLoadingLocation.findUnique({
          where: { id: loadingLocationId },
          select: { supplierId: true },
        });
        if (
          !fulfillment ||
          fulfillment.orderId !== orderId ||
          !location ||
          location.supplierId !== fulfillment.supplierId
        ) {
          throw new Error("Lokacija ne pripada ovoj realizaciji.");
        }
        if (!canConfirmSupplierFulfillment(fulfillment.status)) {
          throw new Error(
            `Realizacija u statusu ${fulfillment.status} ne može biti potvrđena.`,
          );
        }
        const activeSend = await tx.backgroundJob.findFirst({
          where: {
            kind: "SUPPLIER_ORDER_EMAIL",
            status: { in: ["QUEUED", "RETRY", "RUNNING"] },
            payload: { path: ["fulfillmentId"], equals: fulfillmentId },
          },
          select: { id: true },
        });
        if (activeSend) {
          throw new Error(
            "Slanje dobavljaču je još u toku. Sačekajte završetak pre potvrde.",
          );
        }
        await tx.supplierLoadingLocation.update({
          where: { id: loadingLocationId },
          data: { address, city },
        });
        await tx.supplierFulfillment.update({
          where: { id: fulfillmentId },
          data: {
            loadingLocationId,
            status: "CONFIRMED",
            confirmedAt: fulfillment.confirmedAt ?? new Date(),
            lastError: null,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: "supplierFulfillment.confirm.mutation",
            entity: "SupplierFulfillment",
            entityId: fulfillmentId,
            diff: {
              requestId,
              reason,
              previousStatus: fulfillment.status,
              status: "CONFIRMED",
              loadingLocationId,
              address,
              city,
            },
          },
        });
      });
      revalidatePath(`/admin/erp/prodajni-nalozi/${orderId}`);
      return {
        ok: true as const,
        entityId: fulfillmentId,
        diff: { requestId, reason, loadingLocationId, address, city, status: "CONFIRMED" },
        message: "Mesto preuzimanja je potvrđeno.",
      };
    },
  )(formData);
}

async function resendSupplierOrderAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    {
      allowed: ["OPS"],
      action: "supplierFulfillment.resend",
      entity: "SupplierFulfillment",
    },
    async (actorId, formData: FormData) => {
      const orderId = String(formData.get("orderId") ?? "");
      const fulfillmentId = String(formData.get("fulfillmentId") ?? "");
      const reason = String(formData.get("reason") ?? "").trim();
      const requestId = String(formData.get("requestId") ?? "");
      if (
        !orderId ||
        !fulfillmentId ||
        reason.length < 5 ||
        reason.length > 500 ||
        !isUuid(requestId)
      ) {
        return { ok: false as const, error: "Nedostaje realizacija dobavljača." };
      }
      const result = await db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            orderId: string;
            status: SupplierFulfillmentStatus;
            integrationKey: string | null;
            enabled: boolean;
          }>
        >(Prisma.sql`
          SELECT sf."id", sf."orderId", sf."status", s."integrationKey", s."enabled"
          FROM "SupplierFulfillment" sf
          JOIN "Supplier" s ON s."id" = sf."supplierId"
          WHERE sf."id" = ${fulfillmentId}
          FOR UPDATE OF sf
        `);
        const fulfillment = rows[0];
        if (!fulfillment || fulfillment.orderId !== orderId) {
          throw new Error("Realizacija nije dostupna za slanje.");
        }
        if (!isRabaluxSupplierOperational(fulfillment)) {
          throw new Error("Dobavljačka veza je isključena.");
        }
        if (!canResendSupplierOrder(fulfillment.status)) {
          throw new Error(
            `Realizacija u statusu ${fulfillment.status} nije dostupna za ponovno slanje.`,
          );
        }
        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          select: {
            paymentMethod: true,
            payments: { select: { status: true } },
          },
        });
        const ready = fulfillmentPaymentReadiness({
          purpose: "ORDER_DELIVERY",
          paymentMethod: order.paymentMethod,
          paymentStatuses: order.payments.map((payment) => payment.status),
        }).ready;
        const kind = ready
          ? "SUPPLIER_SHIPPING_DOCUMENTS_EMAIL"
          : "SUPPLIER_ORDER_EMAIL";
        const idempotencyKey = `${
          ready ? "supplier-shipping-documents" : "supplier-order"
        }-resend:${fulfillmentId}:${requestId}`;
        const existingRequest = await tx.backgroundJob.findUnique({
          where: { idempotencyKey },
          select: { id: true },
        });
        const active = await tx.backgroundJob.findFirst({
          where: {
            kind: {
              in: [
                "SUPPLIER_ORDER_EMAIL",
                "SUPPLIER_SHIPPING_DOCUMENTS_EMAIL",
              ],
            },
            status: { in: ["QUEUED", "RETRY", "RUNNING"] },
            payload: { path: ["fulfillmentId"], equals: fulfillmentId },
          },
          select: { id: true },
        });
        if (existingRequest || active) return { alreadyQueued: true };
        await tx.backgroundJob.create({
          data: {
            kind,
            payload: { fulfillmentId, dispatchKey: requestId },
            idempotencyKey,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: "supplierFulfillment.resend.mutation",
            entity: "SupplierFulfillment",
            entityId: fulfillmentId,
            diff: { requestId, reason, status: fulfillment.status, queued: true },
          },
        });
        return { alreadyQueued: false, ready };
      });
      revalidatePath(`/admin/erp/prodajni-nalozi/${orderId}`);
      return {
        ok: true as const,
        entityId: fulfillmentId,
        diff: { requestId, reason, queued: true, alreadyQueued: result.alreadyQueued },
        message: result.alreadyQueued
          ? "Slanje je već u redu i nije duplirano."
          : result.ready
            ? "Adresnica i dokument za pakovanje stavljeni su u red za ponovno slanje."
            : "Rezervacija bez dozvole za slanje stavljena je u red.",
      };
    },
  )(formData);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
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
        revalidatePath(`/admin/erp/prodajni-nalozi/${id}`);
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

      revalidatePath(`/admin/erp/prodajni-nalozi/${id}`);
      revalidatePath("/admin/erp/prodajni-nalozi");
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

export async function WebOrderDetail({ id }: { id: string }) {
  await requireAdminAction(["OPS"]);
  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          dispatchNoteItems: {
            where: { dispatchNote: { status: { not: "CANCELLED" } } },
            select: { id: true },
          },
          pickupBatchLines: {
            where: { batch: { status: { not: "CANCELLED" } } },
            select: { id: true },
          },
          product: {
            select: {
              packQty: true,
              packWidthCm: true,
              packDepthCm: true,
              packHeightCm: true,
              packGrossWeightKg: true,
              unitPackWidthCm: true,
              unitPackDepthCm: true,
              unitPackHeightCm: true,
              widthCm: true,
              depthCm: true,
              heightCm: true,
              grossWeightKg: true,
              weightKg: true,
            },
          },
        },
      },
      events: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
      paymentRefunds: { orderBy: { createdAt: "desc" } },
      dispatchNotes: {
        where: { status: { not: "CANCELLED" } },
        select: { id: true },
      },
      shipments: { include: { events: { orderBy: { occurredAt: "desc" } } } },
      pickupBatchLines: {
        where: {
          purpose: "ORDER_DELIVERY",
          batch: { status: { not: "CANCELLED" } },
        },
        select: {
          batch: {
            select: {
              number: true,
              status: true,
              externalBookedAt: true,
            },
          },
        },
      },
      invoices: true,
      fiscal: true,
      fiscalDocuments: {
        where: { kind: "SALE", status: "ISSUED" },
        orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
        select: { id: true, receiptNumber: true, issuedAt: true, emailedAt: true, emailError: true },
      },
      reclamations: { select: { id: true, number: true, status: true } },
      supplierFulfillments: {
        include: {
          supplier: {
            select: {
              name: true,
              integrationKey: true,
              loadingLocations: { orderBy: { position: "asc" } },
            },
          },
          loadingLocation: true,
          items: { orderBy: { externalSku: "asc" } },
        },
      },
    },
  });
  if (!order) notFound();
  const [configuredPaymentMethods, saleFiscalDocumentCount] = await Promise.all([
    getCheckoutPaymentMethods(),
    db.fiscalDocument.count({ where: { orderId: order.id, kind: "SALE" } }),
  ]);
  const courierPackages = derivePhysicalPackages(
    order.items.map((item) => ({
      id: item.id,
      name: item.name,
      qty: item.qty,
      product: item.product,
    })),
  );
  const courierRouting = resolveCourierProvider({
    shippingMethod: order.shippingMethod,
    items: courierPackages.map((pkg) => ({
      withAssembly: false,
      qty: 1,
      packQty: 1,
      packWidthCm: pkg.widthCm,
      packDepthCm: pkg.depthCm,
      packHeightCm: pkg.heightCm,
      packGrossWeightKg: pkg.weightKg,
    })),
  });
  const automaticProvider =
    courierRouting.kind === "single"
      ? courierRouting.provider === "MYGLS"
        ? MYGLS_PROVIDER
        : X_EXPRESS_PROVIDER
      : "";
  const allOrderItemIds = order.items.map((item) => item.id);
  const assignedOrderItemIds = new Set<string>();
  for (const shipment of order.shipments) {
    if (shipment.purpose !== "ORDER_DELIVERY" || shipment.status === "FAILED") {
      continue;
    }
    const assignment = readShipmentAssignment(shipment.rawCreateResponse);
    for (const itemId of assignment?.orderItemIds ?? allOrderItemIds) {
      assignedOrderItemIds.add(itemId);
    }
  }
  const availableCourierItems = order.items.filter(
    (item) => !assignedOrderItemIds.has(item.id),
  );
  const courierPaymentReadiness = fulfillmentPaymentReadiness({
    purpose: "ORDER_DELIVERY",
    paymentMethod: order.paymentMethod,
    paymentStatuses: order.payments.map((payment) => payment.status),
  });
  const bankTransferPayment =
    order.payments.find(
      (payment) =>
        payment.method === "UPLATA_NA_RACUN" && payment.provider === "MANUAL",
    ) ?? null;
  const bankTransferPaid = bankTransferPayment?.status === "PAID";
  const todayInBelgrade = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const activeDeliveryShipments = order.shipments.filter(
    (shipment) =>
      shipment.purpose === "ORDER_DELIVERY" && shipment.status !== "FAILED",
  );
  const allCourierAssignmentsActive =
    availableCourierItems.length === 0 &&
    activeDeliveryShipments.length > 0 &&
    activeDeliveryShipments.every((shipment) =>
      shipment.provider === X_EXPRESS_PROVIDER
        ? Boolean(shipment.providerShipmentId)
        : shipment.provider === MYGLS_PROVIDER
          ? Boolean(shipment.providerShipmentId && shipment.labelObjectKey)
          : Boolean(shipment.trackingNo),
    );
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
  const shippingEditWaybillPlan = planWebOrderShippingEdit(order.shipments);
  const shippingEditPickupBatchReason = shippingEditPickupBatchBlockReason(
    order.pickupBatchLines.map((line) => line.batch),
  );
  const shippingEditBlockedReason =
    !["KREIRANO", "POTVRDJENO", "U_PRIPREMI", "SPREMNO_ZA_ISPORUKU"].includes(
      order.status,
    ) ||
    order.cancelledAt ||
    order.stockRestoredAt
      ? "Adresa i telefon mogu da se menjaju samo pre nego što pošiljka krene ka kupcu."
      : shippingEditPickupBatchReason
        ? shippingEditPickupBatchReason
        : shippingEditWaybillPlan.kind === "BLOCKED"
          ? shippingEditWaybillPlan.reason
          : null;
  const shippingWaybillQuestion = shippingEditWaybillQuestion(
    shippingEditWaybillPlan,
  );
  const refundRequestId = randomUUID();
  const buyerReceipt =
    order.invoices.find((invoice) => invoice.kind === "PROFORMA") ?? null;
  const latestFiscal = order.fiscalDocuments[0] ?? null;
  const businessBuyer = [
    order.shipCompanyName,
    order.shipPib,
    order.billCompanyName,
    order.billPib,
  ].some((value) => Boolean(value?.trim()));
  const activeRabaluxOrderItemIds = new Set(
    order.supplierFulfillments
      .filter(
        (fulfillment) =>
          fulfillment.supplier.integrationKey === "RABALUX" &&
          !["CANCELLED", "COMPLETED"].includes(fulfillment.status),
      )
      .flatMap((fulfillment) =>
        fulfillment.items.map((item) => item.orderItemId),
      ),
  );
  const mixedRabaluxOrder =
    activeRabaluxOrderItemIds.size > 0 &&
    order.items.some((item) => !activeRabaluxOrderItemIds.has(item.id));
  const paymentChangeAttempts = order.payments.map((payment) => ({
    status: payment.status,
    providerRef: payment.providerRef,
    paymentReference: payment.paymentReference,
    redirectUrl: payment.redirectUrl,
    hasRawRequest: payment.rawRequest != null,
    hasRawResponse: payment.rawResponse != null,
  }));
  const paymentChangeOptions = configuredPaymentMethods.flatMap((method) => {
    const value = clientPaymentMethodToDb(method.id);
    if (
      !EDITABLE_WEB_ORDER_PAYMENT_METHODS.includes(
        value as (typeof EDITABLE_WEB_ORDER_PAYMENT_METHODS)[number],
      ) ||
      value === order.paymentMethod
    ) {
      return [];
    }
    try {
      planWebOrderPaymentMethodChange({
        currentMethod: order.paymentMethod,
        nextMethod: value,
        businessBuyer,
        mixedRabaluxOrder,
        attempts: paymentChangeAttempts,
      });
      return [{ value, label: method.label }];
    } catch {
      return [];
    }
  });
  const currentEditablePayments = order.payments.filter(
    (payment) => payment.status !== "FAILED",
  );
  const canOfferWebItemEdit =
    ["KREIRANO", "POTVRDJENO", "U_PRIPREMI"].includes(order.status) &&
    !order.stockRestoredAt &&
    !order.cancelledAt &&
    !order.fiscal &&
    saleFiscalDocumentCount === 0 &&
    order.reclamations.length === 0 &&
    order.paymentRefunds.length === 0 &&
    order.shipments.every(
      (shipment) =>
        shipment.purpose !== "ORDER_DELIVERY" || shipment.status === "FAILED",
    ) &&
    currentEditablePayments.length > 0 &&
    currentEditablePayments.every(
      (payment) =>
        payment.status === "PENDING" &&
        ["MANUAL", "COD"].includes(payment.provider) &&
        !payment.providerRef &&
        !payment.paymentReference &&
        !payment.redirectUrl,
    );
  const canOfferPaymentMethodEdit =
    ["KREIRANO", "POTVRDJENO", "U_PRIPREMI"].includes(order.status) &&
    !order.stockRestoredAt &&
    !order.cancelledAt &&
    !order.fiscal &&
    saleFiscalDocumentCount === 0 &&
    order.reclamations.length === 0 &&
    order.paymentRefunds.length === 0 &&
    order.dispatchNotes.length === 0 &&
    order.items.every(
      (item) =>
        item.warehouseDispatchedQty === 0 &&
        item.dispatchNoteItems.length === 0 &&
        item.pickupBatchLines.length === 0,
    ) &&
    order.pickupBatchLines.length === 0 &&
    activeDeliveryShipments.length === 0 &&
    paymentChangeOptions.length > 0;

  return (
    <>
      <PageHeader
        title={`Porudžbina ${order.number}`}
        description={`${order.shipFirstName} ${order.shipLastName} · ${order.shipCity}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { href: "/admin/erp/prodajni-nalozi", label: "Prodajni nalozi" },
          { label: order.number },
        ]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <p className="rounded-xl border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
            Novi artikal može da se doda, a postojeća količina da se poveća,
            smanji ili ukloni samo pre naplate, fiskalizacije i otpreme;
            poslednja stavka se uklanja otkazivanjem cele porudžbine. Adresa i
            telefon mogu da se isprave do predaje pošiljke kuriru, uz obaveznu
            zamenu postojeće adresnice.
          </p>
          <Card>
            <CardTitle>Identitet prodajnog naloga</CardTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Broj porudžbine">
                <input
                  value={order.number}
                  readOnly
                  disabled
                  className="h-9 rounded-lg border border-input bg-muted-bg px-3 text-sm disabled:opacity-70"
                />
              </Field>
              <Field label="Vrsta porudžbine">
                <select
                  value="WEB"
                  disabled
                  aria-label="Vrsta porudžbine"
                  className="h-9 rounded-lg border border-input bg-muted-bg px-3 text-sm disabled:opacity-70"
                >
                  <option value="WEB">WEB</option>
                </select>
              </Field>
              <Field label="Način kupovine">
                <input
                  value={order.userId ? "Ulogovan korisnik" : "Bez prijave"}
                  readOnly
                  disabled
                  className="h-9 rounded-lg border border-input bg-muted-bg px-3 text-sm disabled:opacity-70"
                />
              </Field>
            </div>
          </Card>
          <Card>
            <CardTitle>Stavke</CardTitle>
            <DataTable
              columns={[
                { key: "sku", label: "SKU" },
                { key: "name", label: "Naziv" },
                { key: "qty", label: "Kol", align: "right" },
                { key: "price", label: "Cena", align: "right" },
                { key: "subtotal", label: "Ukupno", align: "right" },
                ...(canOfferWebItemEdit
                  ? [{ key: "edit", label: "Izmena", align: "right" as const }]
                  : []),
              ]}
              rows={order.items.map((it) => ({
                id: it.id,
                cells: {
                  sku: <span className="font-mono text-xs">{it.sku}</span>,
                  name: it.name,
                  qty: it.qty,
                  price: formatRsd(num(it.unitPriceSale)),
                  subtotal: formatRsd(num(it.unitPriceSale) * it.qty),
                  ...(canOfferWebItemEdit
                    ? {
                        edit:
                          order.items.length > 1 || it.qty > 1 ? (
                            <AdminActionForm
                              action={updateWebOrderItemQuantityAction}
                              preserveValues
                              refreshOnSuccess
                              className="flex min-w-48 items-end justify-end gap-2"
                            >
                              <input type="hidden" name="orderId" value={order.id} />
                              <input type="hidden" name="orderItemId" value={it.id} />
                              <Field label="Nova kol." className="w-20 text-left">
                                <input
                                  type="number"
                                  name="newQty"
                                  min={0}
                                  max={it.qty - 1}
                                  step={1}
                                  defaultValue={it.qty > 1 ? it.qty - 1 : 0}
                                  required
                                  aria-label={`Nova količina za ${it.sku}`}
                                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-right text-sm"
                                />
                              </Field>
                              <SubmitButton
                                size="sm"
                                variant="outline"
                                confirm={`Promeniti ${it.sku} sa ${it.qty} na unetu količinu? Iznosi, rezervacije i predračun biće preračunati; kupcu dokument neće biti automatski poslat.`}
                              >
                                Sačuvaj
                              </SubmitButton>
                            </AdminActionForm>
                          ) : (
                            <AdminActionForm
                              action={updateStatus}
                              refreshOnSuccess
                              className="flex justify-end"
                            >
                              <input type="hidden" name="id" value={order.id} />
                              <input type="hidden" name="status" value="OTKAZANO" />
                              <input
                                type="hidden"
                                name="note"
                                value="Cela WEB porudžbina je otkazana umesto uklanjanja poslednje stavke."
                              />
                              <SubmitButton
                                size="xs"
                                variant="destructive"
                                pendingLabel="Otkazivanje…"
                                confirm={`Otkazati celu porudžbinu ${order.number}? Rezervisana roba biće vraćena na lager i kupac će dobiti obaveštenje.`}
                              >
                                Otkaži nalog
                              </SubmitButton>
                            </AdminActionForm>
                          ),
                      }
                    : {}),
                },
              }))}
              empty="Bez stavki."
            />
            {canOfferWebItemEdit ? (
              <AdminActionForm
                action={addWebOrderItemAction}
                refreshOnSuccess
                testId="web-order-item-add-form"
                className="mt-5 rounded-xl border border-border/70 bg-muted-bg/40 p-4"
              >
                <div className="mb-3">
                  <h3 className="font-medium text-ink-900">Dodaj artikal</h3>
                  <p className="mt-1 text-sm text-ink-500">
                    Unesite tačnu šifru iz WEB kataloga. Ako šifra već postoji
                    u porudžbini, uneta količina će biti dodata na postojeću.
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="orderId" value={order.id} />
                  <Field label="Šifra artikla" className="min-w-56 flex-1">
                    <input
                      name="sku"
                      type="text"
                      required
                      maxLength={100}
                      autoComplete="off"
                      aria-label="Šifra artikla za dodavanje"
                      className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm uppercase"
                    />
                  </Field>
                  <Field label="Količina" className="w-28">
                    <input
                      name="qty"
                      type="number"
                      min={1}
                      max={999}
                      step={1}
                      defaultValue={1}
                      required
                      aria-label="Količina artikla za dodavanje"
                      className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-right text-sm"
                    />
                  </Field>
                  <SubmitButton
                    pendingLabel="Dodavanje…"
                    confirm="Dodati uneti artikal u WEB porudžbinu? Cena, dostava, rezervacije i ukupan iznos biće ponovo obračunati."
                  >
                    Dodaj artikal
                  </SubmitButton>
                </div>
              </AdminActionForm>
            ) : null}
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
            {shippingEditBlockedReason ? (
              <p className="mt-4 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-sm text-warning">
                Izmena je trenutno zaključana. {shippingEditBlockedReason}
              </p>
            ) : (
              <div className="mt-5 flex flex-col gap-3">
                <details className="rounded-xl border border-border/70 bg-muted-bg/20">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-ink-900 marker:hidden [&::-webkit-details-marker]:hidden">
                    Izmeni adresu
                  </summary>
                  <AdminActionForm
                    action={updateShippingAddressAction}
                    preserveValues
                    refreshOnSuccess
                    className="border-t border-border/70 p-4"
                    testId="shipping-address-edit-form"
                  >
                    <input type="hidden" name="orderId" value={order.id} />
                    <input
                      type="hidden"
                      name="expectedUpdatedAt"
                      value={order.updatedAt.toISOString()}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Ulica i broj" className="sm:col-span-2">
                        <input
                          name="street"
                          defaultValue={order.shipStreet}
                          minLength={3}
                          maxLength={200}
                          autoComplete="street-address"
                          required
                          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
                        />
                      </Field>
                      <Field label="Grad / mesto">
                        <input
                          name="city"
                          defaultValue={order.shipCity}
                          minLength={2}
                          maxLength={80}
                          autoComplete="address-level2"
                          required
                          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
                        />
                      </Field>
                      <Field label="Poštanski broj">
                        <input
                          name="postalCode"
                          defaultValue={order.shipPostalCode}
                          inputMode="numeric"
                          pattern="[0-9]{5}"
                          maxLength={5}
                          autoComplete="postal-code"
                          required
                          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
                        />
                      </Field>
                    </div>
                    {order.glsDeliveryPointId ? (
                      <label className="mt-4 flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/10 p-3 text-sm text-warning">
                        <input
                          type="checkbox"
                          name="clearDeliveryPoint"
                          value="yes"
                          required
                          className="mt-0.5 size-4"
                        />
                        <span>
                          Potvrđujem da se uklanja postojeće GLS mesto
                          preuzimanja i da isporuka ide na novu kućnu adresu.
                        </span>
                      </label>
                    ) : null}
                    <WaybillReplacementFields plan={shippingEditWaybillPlan} />
                    <div className="mt-4 flex justify-end">
                      <SubmitButton
                        confirm={
                          shippingWaybillQuestion ??
                          "Sačuvati novu adresu isporuke na ovoj porudžbini?"
                        }
                      >
                        Sačuvaj adresu
                      </SubmitButton>
                    </div>
                  </AdminActionForm>
                </details>

                <details className="rounded-xl border border-border/70 bg-muted-bg/20">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-ink-900 marker:hidden [&::-webkit-details-marker]:hidden">
                    Izmeni broj telefona
                  </summary>
                  <AdminActionForm
                    action={updateShippingPhoneAction}
                    preserveValues
                    refreshOnSuccess
                    className="border-t border-border/70 p-4"
                    testId="shipping-phone-edit-form"
                  >
                    <input type="hidden" name="orderId" value={order.id} />
                    <input
                      type="hidden"
                      name="expectedUpdatedAt"
                      value={order.updatedAt.toISOString()}
                    />
                    <Field
                      label="Broj telefona"
                      hint="Unesite 9 ili 10 cifara; broj mora početi sa 06."
                    >
                      <input
                        name="phone"
                        type="tel"
                        defaultValue={order.shipPhone}
                        minLength={9}
                        maxLength={20}
                        autoComplete="tel"
                        required
                        className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
                      />
                    </Field>
                    <WaybillReplacementFields plan={shippingEditWaybillPlan} />
                    <div className="mt-4 flex justify-end">
                      <SubmitButton
                        confirm={
                          shippingWaybillQuestion ??
                          "Sačuvati novi broj telefona na ovoj porudžbini?"
                        }
                      >
                        Sačuvaj broj telefona
                      </SubmitButton>
                    </div>
                  </AdminActionForm>
                </details>
              </div>
            )}
          </Card>

          {order.supplierFulfillments.map((fulfillment) => (
            <Card key={fulfillment.id}>
              <CardTitle
                description={`Status: ${fulfillment.status}`}
              >
                Dobavljač · {fulfillment.supplier.name}
              </CardTitle>
              <DataTable
                columns={[
                  { key: "sku", label: "Originalna šifra" },
                  { key: "qty", label: "Kol", align: "right" },
                ]}
                rows={fulfillment.items.map((item) => ({
                  id: item.id,
                  cells: {
                    sku: <span className="font-mono text-xs">{item.externalSku}</span>,
                    qty: item.qty,
                  },
                }))}
                empty="Bez dobavljačkih stavki."
              />
              <dl className="mt-4 space-y-1 text-sm">
                <Row
                  k="Poslato"
                  v={fulfillment.sentAt?.toLocaleString("sr-Latn-RS") ?? "—"}
                />
                <Row
                  k="Potvrđeno"
                  v={fulfillment.confirmedAt?.toLocaleString("sr-Latn-RS") ?? "—"}
                />
                <Row
                  k="Mesto preuzimanja"
                  v={
                    fulfillment.supplier.integrationKey === "RABALUX"
                      ? "Fiksni Rabalux magacin iz bezbedne RABALUX_PICKUP_* konfiguracije"
                      : fulfillment.loadingLocation
                      ? `${fulfillment.loadingLocation.name} · ${
                          fulfillment.loadingLocation.address ?? "adresa nije uneta"
                        } · ${fulfillment.loadingLocation.city ?? "grad nije unet"}`
                      : "Nije potvrđeno"
                  }
                />
              </dl>
              {fulfillment.lastError ? (
                <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  {fulfillment.lastError}
                </p>
              ) : null}
              {(fulfillment.supplier.integrationKey !== "RABALUX" &&
                canConfirmSupplierFulfillment(fulfillment.status)) ||
              canResendSupplierOrder(fulfillment.status) ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {fulfillment.supplier.integrationKey !== "RABALUX" &&
                  canConfirmSupplierFulfillment(fulfillment.status) ? (
                    <AdminActionForm
                      action={confirmSupplierFulfillmentAction}
                      className="space-y-3 rounded-lg border border-border p-3"
                    >
                      <input type="hidden" name="orderId" value={order.id} />
                      <input
                        type="hidden"
                        name="fulfillmentId"
                        value={fulfillment.id}
                      />
                      <input type="hidden" name="requestId" value={randomUUID()} />
                      <Field label="Potvrđena lokacija">
                        <select
                          name="loadingLocationId"
                          defaultValue={fulfillment.loadingLocationId ?? ""}
                          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                        >
                          <option value="">Izaberite</option>
                          {fulfillment.supplier.loadingLocations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.position}. {location.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Adresa">
                        <input
                          name="address"
                          defaultValue={fulfillment.loadingLocation?.address ?? ""}
                          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                        />
                      </Field>
                      <Field label="Grad">
                        <input
                          name="city"
                          defaultValue={fulfillment.loadingLocation?.city ?? ""}
                          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                        />
                      </Field>
                      <Field label="Razlog potvrde">
                        <Textarea name="reason" rows={2} minLength={5} maxLength={500} required />
                      </Field>
                      <SubmitButton
                        size="sm"
                        confirm="Potvrditi mesto preuzimanja i status realizacije?"
                      >
                        Potvrdi preuzimanje
                      </SubmitButton>
                    </AdminActionForm>
                  ) : null}
                  {canResendSupplierOrder(fulfillment.status) ? (
                    <AdminActionForm
                      action={resendSupplierOrderAction}
                      className="space-y-3 rounded-lg border border-border p-3"
                    >
                      <input type="hidden" name="orderId" value={order.id} />
                      <input
                        type="hidden"
                        name="fulfillmentId"
                        value={fulfillment.id}
                      />
                      <input type="hidden" name="requestId" value={randomUUID()} />
                      <Field label="Razlog ponovnog slanja">
                        <Textarea name="reason" rows={2} minLength={5} maxLength={500} required />
                      </Field>
                      <div className="flex justify-end">
                        <SubmitButton
                          size="sm"
                          variant="outline"
                          confirm="Ponovo poslati dobavljačku porudžbinu?"
                        >
                          Pošalji ponovo
                        </SubmitButton>
                      </div>
                    </AdminActionForm>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ))}

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
            <CardTitle
              description={`Trenutno: ${adminPaymentMethodLabel(order.paymentMethod)}`}
            >
              Način plaćanja
            </CardTitle>
            {canOfferPaymentMethodEdit ? (
              <AdminActionForm
                action={updateWebOrderPaymentMethodAction}
                className="space-y-3"
                preserveValues
                refreshOnSuccess
                testId="web-order-payment-method-form"
              >
                <input type="hidden" name="orderId" value={order.id} />
                <Field label="Novi način plaćanja">
                  <select
                    name="paymentMethod"
                    defaultValue={order.paymentMethod}
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  >
                    <option value={order.paymentMethod}>
                      {adminPaymentMethodLabel(order.paymentMethod)} (trenutno)
                    </option>
                    {paymentChangeOptions.map((method) => (
                      <option key={method.value} value={method.value}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="text-xs leading-5 text-ink-500">
                  Dostupne su uplata na račun i plaćanje pouzećem. Online
                  plaćanje se ovde ne pokreće ponovo; predračun se osvežava bez
                  automatskog slanja kupcu.
                </p>
                <div className="flex justify-end">
                  <SubmitButton
                    size="sm"
                    confirm="Promeniti način plaćanja? Stara aktivna evidencija biće zatvorena, nova otvorena, a predračun osvežen."
                  >
                    Promeni način plaćanja
                  </SubmitButton>
                </div>
              </AdminActionForm>
            ) : (
              <p className="text-sm leading-6 text-ink-500">
                Izmena je dostupna samo pre pokretanja ili potvrde naplate,
                fiskalizacije, otpremnice i isporuke. Za pravno lice ostaje
                obavezna uplata na račun.
              </p>
            )}
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
                <SubmitButton
                  size="sm"
                  confirm="Sačuvati novi status porudžbine? Otkazivanje vraća robu na lager, a pojedini statusi mogu pokrenuti obaveštenje ili kurirski nalog."
                >
                  Sačuvaj
                </SubmitButton>
              </div>
            </AdminActionForm>
          </Card>

          {order.paymentMethod === "UPLATA_NA_RACUN" ? (
            <Card>
              <CardTitle
                description={
                  bankTransferPaid ? "Uplata je potvrđena" : "Čeka uplatu"
                }
              >
                Uplata na račun
              </CardTitle>
              <dl className="mb-4 space-y-1 text-sm">
                <Row k="Status" v={bankTransferPayment?.status ?? "NEMA EVIDENCIJE"} />
                <Row
                  k="Iznos"
                  v={formatRsd(num(bankTransferPayment?.amount ?? order.total))}
                />
                <Row
                  k="Datum uplate"
                  v={
                    bankTransferPayment?.paidAt
                      ? bankTransferPayment.paidAt.toLocaleDateString("sr-Latn-RS")
                      : "—"
                  }
                />
                <Row
                  k="Referenca izvoda"
                  v={bankTransferPayment?.providerRef ?? "—"}
                />
              </dl>
              {bankTransferPayment?.status === "PENDING" ? (
                <AdminActionForm
                  action={confirmBankTransferPaymentAction}
                  className="space-y-3 rounded-lg border border-warning/30 bg-warning/5 p-3"
                >
                  <input type="hidden" name="orderId" value={order.id} />
                  <input
                    type="hidden"
                    name="paymentId"
                    value={bankTransferPayment.id}
                  />
                  <p className="text-sm text-ink-700">
                    Prvo proverite izvod banke. Ovo dugme samo beleži da je novac
                    legao; ne pravi adresnicu i ne šalje ništa kuriru.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Datum kada je novac legao">
                      <input
                        name="paidOn"
                        type="date"
                        required
                        defaultValue={todayInBelgrade}
                        className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                      />
                    </Field>
                    <Field label="Poziv na broj / referenca izvoda">
                      <input
                        name="statementReference"
                        required
                        maxLength={180}
                        className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                      />
                    </Field>
                  </div>
                  <Field label="Napomena (opciono)">
                    <Textarea name="note" rows={2} maxLength={500} />
                  </Field>
                  <div className="flex justify-end">
                    <SubmitButton
                      size="sm"
                      confirm="Potvrditi da je novac stvarno legao na bankovni račun? Ova radnja se beleži u auditu."
                    >
                      Potvrdi da je uplata legla
                    </SubmitButton>
                  </div>
                </AdminActionForm>
              ) : bankTransferPaid ? (
                <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
                  Uplata je potvrđena. Porudžbina sme u picking i kurirski nalog.
                </p>
              ) : (
                <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
                  Uplata nije u statusu koji dozvoljava slanje. Proverite evidenciju
                  plaćanja pre nastavka.
                </p>
              )}
            </Card>
          ) : null}

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
                    <SubmitButton
                      variant="destructive"
                      size="sm"
                      confirm="Izvršiti IPS povraćaj? Proverite iznos i referencu transakcije pre potvrde."
                    >
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
                    {order.shipments.map((shipment) => {
                      const assignment = readShipmentAssignment(
                        shipment.rawCreateResponse,
                      );
                      const shipmentItems = (
                        assignment?.orderItemIds ??
                        (shipment.purpose === "ORDER_DELIVERY"
                          ? allOrderItemIds
                          : [])
                      )
                        .map((itemId) => order.items.find((item) => item.id === itemId))
                        .filter((item): item is (typeof order.items)[number] => Boolean(item));
                      return (
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
                          <Row
                            k="Kurir status"
                            v={
                              shipment.providerStatusCode === "LOCAL_PREPARED"
                                ? "Adresnica pripremljena — nije poslato"
                                : shipment.providerStatusCode === "LOCAL_ANNOUNCING"
                                  ? "Slanje u toku"
                                  : shipment.providerStatusCode ===
                                      "LOCAL_ANNOUNCEMENT_FAILED"
                                    ? "Slanje nije uspelo"
                                    : shipment.providerStatusCode ?? "—"
                            }
                          />
                          <Row k="Paketa" v={shipment.packageCount} />
                          <Row
                            k="Stavke"
                            v={
                              shipmentItems.length
                                ? shipmentItems
                                    .map((item) => `${item.sku} · ${item.name}`)
                                    .join(", ")
                                : "Reklamacija / ručni nalog"
                            }
                          />
                          {assignment &&
                          assignment.codAmount > 0 &&
                          isCashOnDeliveryPaymentMethod(order.paymentMethod) ? (
                            <Row k="COD ovog naloga" v={formatRsd(assignment.codAmount)} />
                          ) : null}
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
                          {shipment.labelUrl &&
                          (shipment.purpose !== "ORDER_DELIVERY" ||
                            courierPaymentReadiness.ready) ? (
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
                          {shipment.provider === X_EXPRESS_PROVIDER &&
                          shipment.trackingNo &&
                          !shipment.providerShipmentId &&
                          shipment.status !== "FAILED" &&
                          (shipment.purpose !== "ORDER_DELIVERY" ||
                            courierPaymentReadiness.ready) ? (
                            <AdminActionForm action={announceXExpressCourierShipment}>
                              <input type="hidden" name="shipmentId" value={shipment.id} />
                              <input type="hidden" name="orderId" value={order.id} />
                              <SubmitButton
                                variant="outline"
                                size="xs"
                                pendingLabel="Ponovno slanje…"
                                confirm="Ponoviti automatsko slanje X Express-u?"
                              >
                                Ponovi automatsko slanje
                              </SubmitButton>
                            </AdminActionForm>
                          ) : null}
                          {shipment.provider &&
                          shipment.trackingNo &&
                          (shipment.provider !== X_EXPRESS_PROVIDER ||
                            Boolean(shipment.providerShipmentId)) ? (
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
                              {isCashOnDeliveryPaymentMethod(order.paymentMethod) ? (
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
                                  <SubmitButton
                                    variant="outline"
                                    size="xs"
                                    confirm="Izmeniti COD iznos kod MyGLS-a? Proverite iznos pre potvrde."
                                  >
                                    Izmeni COD
                                  </SubmitButton>
                                </AdminActionForm>
                              ) : null}
                              <AdminActionForm action={deleteMyGlsShipment}>
                                <input type="hidden" name="shipmentId" value={shipment.id} />
                                <input type="hidden" name="orderId" value={order.id} />
                                <SubmitButton
                                  variant="destructive"
                                  size="xs"
                                  confirm="Otkazati MyGLS nalog i obrisati etiketu? Ova akcija se šalje kurirskom provajderu."
                                >
                                  Obriši GLS
                                </SubmitButton>
                              </AdminActionForm>
                            </>
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
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-ink-500">Kurirski nalog još nije kreiran.</p>
                )}
                {!courierPaymentReadiness.ready ? (
                  <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-warning">
                    Čeka se potvrda plaćanja. Ova porudžbina ne može u adresnicu
                    niti u kurirski nalog dok uplata ne bude potvrđena.
                  </p>
                ) : availableCourierItems.length ? (
                  <AdminActionForm
                    action={createCourierShipment}
                    className="space-y-3 rounded-lg border border-border p-3"
                  >
                    <input type="hidden" name="id" value={order.id} />
                    <Field
                      label="Kurir za izabrane stavke"
                      hint="Možete prvo napraviti nalog za X Express stavke, a zatim poseban MyGLS nalog za preostale."
                    >
                      <select
                        name="provider"
                        defaultValue={automaticProvider}
                        className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                      >
                        <option value="" disabled>Automatski izbor nije moguć</option>
                        <option value={X_EXPRESS_PROVIDER}>X Express</option>
                        <option value={MYGLS_PROVIDER}>MyGLS (GLS)</option>
                      </select>
                    </Field>
                    <fieldset className="space-y-2">
                      <legend className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
                        Stavke u ovom kurirskom nalogu
                      </legend>
                      {availableCourierItems.map((item) => (
                        <label
                          key={item.id}
                          className="flex items-start gap-2 rounded-lg border border-border/70 p-2"
                        >
                          <input
                            type="checkbox"
                            name="orderItemIds"
                            value={item.id}
                            defaultChecked
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block font-medium">
                              {item.sku} · {item.name}
                            </span>
                            <span className="text-xs text-ink-500">
                              {item.qty} × {formatRsd(num(item.unitPriceSale))}
                            </span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <Field label="Broj paketa" hint="Za MyGLS se koriste mere fizičkih paketa.">
                        <input
                          name="packageCount"
                          type="number"
                          min={1}
                          max={99}
                          defaultValue={Math.max(
                            1,
                            availableCourierItems.reduce(
                              (sum, item) => sum + item.qty,
                              0,
                            ),
                          )}
                          className="h-8 w-24 rounded-lg border border-input bg-transparent px-2 text-sm"
                        />
                      </Field>
                      <SubmitButton
                        size="sm"
                        confirm="Kreirati poseban kurirski nalog samo za označene stavke?"
                      >
                        Kreiraj nalog za izabrane stavke
                      </SubmitButton>
                    </div>
                  </AdminActionForm>
                ) : allCourierAssignmentsActive ? (
                  <p className="rounded-lg bg-success/10 px-3 py-2 text-success">
                    Sve stavke porudžbine imaju aktivan kurirski nalog.
                  </p>
                ) : (
                  <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-warning">
                    Kurirski nalog je samo lokalno pripremljen ili slanje nije
                    završeno. Nije potvrđeno da je kurir prihvatio sve stavke.
                  </p>
                )}
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
                <SubmitButton
                  size="sm"
                  confirm="Izdati ili ponovo poslati dokument kupcu? Proverite adresu e-pošte pre potvrde."
                >
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
              <SubmitButton
                size="sm"
                confirm="Izdati ili ponovo poslati fiskalni račun? Ova akcija poziva fiskalnog i email provajdera."
              >
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
                <SubmitButton
                  size="sm"
                  confirm="Ručno sačuvati broj fiskalnog računa? Potvrdite da se broj tačno poklapa sa dokumentom provajdera."
                >
                  Sačuvaj
                </SubmitButton>
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

function WaybillReplacementFields({
  plan,
}: {
  plan: WebOrderShippingEditPlan;
}) {
  if (plan.kind !== "REPLACE_WAYBILLS") return null;
  const question = shippingEditWaybillQuestion(plan);
  const tracking = plan.activeShipments
    .map((shipment) => shipment.trackingNo)
    .filter(Boolean)
    .join(", ");
  const requiresManualXExpressCancellation =
    plan.manuallyCancelledXExpressShipments.length > 0;

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm text-warning">
      <p className="font-medium">{question}</p>
      {tracking ? (
        <p className="text-xs">Aktivni broj pošiljke: {tracking}</p>
      ) : null}
      {requiresManualXExpressCancellation ? (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="confirmXExpressCancellation"
            value="yes"
            required
            className="mt-0.5 size-4"
          />
          <span>
            Potvrđujem da sam staru X Express adresnicu prvo poništio/la u X
            Express portalu ili preko njihove podrške.
          </span>
        </label>
      ) : null}
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="replaceWaybills"
          value="yes"
          required
          className="mt-0.5 size-4"
        />
        <span>
          Da, poništi {plan.activeShipments.length === 1 ? "staru adresnicu" : "stare adresnice"}
          {requiresManualXExpressCancellation ? " u sistemu" : ""} i napravi
          {plan.activeShipments.length === 1 ? " novu" : " nove"} sa
          ispravljenim podacima.
        </span>
      </label>
    </div>
  );
}

async function smallParcelAutoCreateEnabled() {
  return getMyGlsConfig().autoCreate || getXExpressConfig().autoCreate;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between text-ink-700">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
