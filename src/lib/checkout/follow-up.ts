import "server-only";
import { db } from "@/lib/db";
import { enqueueBackgroundJob, processBackgroundJob } from "@/lib/background-jobs";
import { isCashOnDeliveryPaymentMethod } from "@/lib/payments/fulfillment-readiness";

/** Runs only in a worker, after checkout has committed and returned success. */
export async function prepareCheckoutFollowUp(orderId: string, accessToken: string) {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      number: true, paymentMethod: true, shippingMethod: true,
      supplierFulfillments: { select: { id: true } },
      items: { select: {
        qty: true, productId: true,
        product: { select: { supplier: { select: { integrationKey: true } } } },
      } },
    },
  });
  // Persist every child job before running any provider. If interrupted here,
  // retrying the parent repairs missing jobs using the same idempotency keys.
  const buyer = await enqueueBackgroundJob({
    kind: "BUYER_RECEIPT", payload: { orderId, accessToken },
    idempotencyKey: `buyer-receipt:${orderId}`,
  });
  const supplierJobs = [];
  const documentJobs = [];
  for (const fulfillment of order.supplierFulfillments) {
    supplierJobs.push(await enqueueBackgroundJob({
      kind: "SUPPLIER_ORDER_EMAIL",
      payload: { fulfillmentId: fulfillment.id, dispatchKey: "checkout" },
      idempotencyKey: `supplier-order:${fulfillment.id}:checkout`,
    }));
    if (order.shippingMethod === "KURIR" && isCashOnDeliveryPaymentMethod(order.paymentMethod)) {
      documentJobs.push(await enqueueBackgroundJob({
        kind: "SUPPLIER_SHIPPING_DOCUMENTS_EMAIL",
        payload: { fulfillmentId: fulfillment.id, dispatchKey: "checkout" },
        idempotencyKey: `supplier-shipping-documents:${fulfillment.id}:checkout`,
      }));
    }
  }
  const genericLines = order.items.flatMap(item =>
    item.productId && item.product?.supplier?.integrationKey !== "RABALUX"
      ? [{ productId: item.productId, qty: item.qty }] : []);
  if (genericLines.length) {
    await enqueueBackgroundJob({
      kind: "SUPPLIER_RESERVATION",
      payload: { orderNumber: order.number, lines: genericLines },
      idempotencyKey: `supplier-reservation:${orderId}`,
    });
  }
  // These are independent jobs with their own retries. A broken supplier PDF
  // cannot prevent the buyer job from running. Documents retain their existing
  // courier schedule and supplier-order/payment prerequisites in the worker.
  await Promise.allSettled([buyer, ...supplierJobs].map(job => processBackgroundJob(job.id)));
  await Promise.allSettled(documentJobs.map(job => processBackgroundJob(job.id)));
}
