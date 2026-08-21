import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import { resolveDeliveryQuote } from "@/lib/checkout/config";
import { adjustInventory } from "@/lib/inventory";
import { syncProductChannelAvailability } from "@/lib/channel-availability.server";
import { issueBuyerReceiptForOrder } from "@/lib/receipts";
import {
  calculateEditedWebOrderTotals,
  planWebOrderQuantityReduction,
} from "./web-order-edit";

const EDITABLE_WEB_ORDER_STATUSES = [
  "KREIRANO",
  "POTVRDJENO",
  "U_PRIPREMI",
] as const;

type LockedBackgroundJob = {
  id: string;
  kind: string;
  idempotencyKey: string;
  status: string;
  payload: Prisma.JsonValue;
};

type LockedVoucher = {
  code: string;
  kind: "PERCENT" | "FIXED";
  amount: Prisma.Decimal;
  minSubtotal: Prisma.Decimal | null;
};

function decimal(value: number) {
  return new Prisma.Decimal(value.toFixed(2));
}

function jobCanStillReadUpdatedOrder(job: LockedBackgroundJob | undefined) {
  return job?.status === "QUEUED" || job?.status === "RETRY";
}

function genericSupplierCallbackConfigured(item: {
  supplierIntegrationKey: string | null;
  supplierExternalSku: string | null;
  product: {
    supplierExternalId: string | null;
    supplier: {
      enabled: boolean;
      feedUrl: string | null;
      integrationKey: string | null;
    } | null;
  } | null;
}) {
  const supplier = item.product?.supplier;
  return Boolean(
    item.supplierIntegrationKey !== "RABALUX" &&
      (item.supplierExternalSku || item.product?.supplierExternalId) &&
      supplier?.enabled &&
      supplier.feedUrl &&
      supplier.integrationKey !== "RABALUX",
  );
}

function assertOrderIsEditable(order: {
  channel: string;
  status: string;
  stockRestoredAt: Date | null;
  cancelledAt: Date | null;
  fiscal: unknown;
  fiscalDocuments: unknown[];
  shipments: unknown[];
  dispatchNotes: unknown[];
  pickupBatchLines: unknown[];
  reclamations: unknown[];
  paymentRefunds: unknown[];
  payments: Array<{
    provider: string;
    status: string;
    providerRef: string | null;
    paymentReference: string | null;
    redirectUrl: string | null;
  }>;
  items: Array<{
    warehouseDispatchedQty: number;
    dispatchNoteItems: unknown[];
    pickupBatchLines: unknown[];
  }>;
}) {
  if (order.channel !== "WEB") {
    throw new Error("Ova akcija je dostupna samo za WEB porudžbine.");
  }
  if (
    !EDITABLE_WEB_ORDER_STATUSES.includes(
      order.status as (typeof EDITABLE_WEB_ORDER_STATUSES)[number],
    )
  ) {
    throw new Error("Porudžbina u ovom statusu više ne može da se menja.");
  }
  if (order.stockRestoredAt || order.cancelledAt) {
    throw new Error("Otkazana ili vraćena porudžbina ne može da se menja.");
  }
  if (order.fiscal || order.fiscalDocuments.length) {
    throw new Error("Fiskalizovana porudžbina ili fiskalni zahtev ne mogu da se menjaju.");
  }
  if (order.shipments.length || order.pickupBatchLines.length) {
    throw new Error("Porudžbina uključena u isporuku ili preuzimanje ne može da se menja.");
  }
  if (
    order.dispatchNotes.length ||
    order.items.some(
      (item) =>
        item.warehouseDispatchedQty > 0 || item.dispatchNoteItems.length > 0,
    )
  ) {
    throw new Error("Porudžbina uključena u otpremnicu ne može da se menja.");
  }
  if (order.items.some((item) => item.pickupBatchLines.length > 0)) {
    throw new Error("Stavke uključene u kurirsko preuzimanje ne mogu da se menjaju.");
  }
  if (order.reclamations.length || order.paymentRefunds.length) {
    throw new Error("Porudžbina sa reklamacijom ili povraćajem ne može da se menja.");
  }
  if (!order.payments.length) {
    throw new Error("Porudžbina nema evidentirano plaćanje; potrebna je ručna kontrola.");
  }
  const unsafePayment = order.payments.find(
    (payment) =>
      payment.status !== "PENDING" ||
      !["MANUAL", "COD"].includes(payment.provider) ||
      Boolean(
        payment.providerRef ||
          payment.paymentReference ||
          payment.redirectUrl,
      ),
  );
  if (unsafePayment) {
    throw new Error(
      "Plaćanje je već pokrenuto ili potvrđeno; prvo usaglasite naplatu/povraćaj.",
    );
  }
}

async function lockedVoucherDiscount(
  tx: Prisma.TransactionClient,
  code: string | null,
  subtotal: number,
) {
  if (!code) return 0;
  const rows = await tx.$queryRaw<LockedVoucher[]>(Prisma.sql`
    SELECT code, kind::text AS kind, amount, "minSubtotal"
    FROM "Voucher"
    WHERE code = ${code}
    FOR UPDATE
  `);
  const voucher = rows[0];
  if (!voucher) {
    throw new Error("Vaučer sa porudžbine više ne postoji; izmena je blokirana.");
  }
  if (voucher.minSubtotal && subtotal < num(voucher.minSubtotal)) {
    throw new Error(
      `Smanjeni iznos više ne ispunjava minimum vaučera (${num(
        voucher.minSubtotal,
      ).toLocaleString("sr-Latn-RS")} RSD). Uklonite vaučer uz odobrenje pre izmene.`,
    );
  }
  const amount = num(voucher.amount);
  return voucher.kind === "PERCENT"
    ? Math.round((subtotal * amount) / 100)
    : Math.min(amount, subtotal);
}

export async function updateWebOrderItemQuantity(input: {
  orderId: string;
  orderItemId: string;
  newQty: number;
  actorId: string;
}) {
  if (!input.orderId || !input.orderItemId) {
    throw new Error("Nedostaje porudžbina ili stavka.");
  }
  if (!Number.isInteger(input.newQty) || input.newQty < 0) {
    throw new Error("Nova količina mora biti nenegativan ceo broj.");
  }

  const preview = await db.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      updatedAt: true,
      userId: true,
      shipCity: true,
      shippingMethod: true,
      shipping: true,
      items: {
        orderBy: { id: "asc" },
        select: { id: true, sku: true, qty: true },
      },
    },
  });
  if (!preview) throw new Error("Porudžbina ne postoji.");
  const previewItem = preview.items.find((item) => item.id === input.orderItemId);
  if (!previewItem) throw new Error("Stavka ne pripada porudžbini.");
  if (input.newQty >= previewItem.qty) {
    throw new Error("Količina može samo da se smanji.");
  }
  const previewLines = preview.items.flatMap((item) => {
    const qty = item.id === input.orderItemId ? input.newQty : item.qty;
    return qty > 0 ? [{ sku: item.sku, qty }] : [];
  });
  if (!previewLines.length) {
    throw new Error(
      "Poslednja stavka se ne uklanja pojedinačno; otkažite celu porudžbinu.",
    );
  }
  const deliveryQuote = await resolveDeliveryQuote({
    city: preview.shipCity,
    lines: previewLines,
    loggedIn: Boolean(preview.userId),
  });
  const quotedShipping =
    (preview.shippingMethod === "KURIR"
      ? deliveryQuote.prices.kurir
      : deliveryQuote.prices.kamion) ?? num(preview.shipping);
  const operationKey = randomUUID();

  const result = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`,
      );
      const fulfillmentRows = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "SupplierFulfillment"
          WHERE "orderId" = ${input.orderId}
          ORDER BY "id"
          FOR UPDATE
        `,
      );
      const exactJobKeys = [
        `buyer-receipt:${input.orderId}`,
        `supplier-reservation:${input.orderId}`,
        `fiscal-advance:${input.orderId}`,
        `fiscal-pickup:${input.orderId}`,
      ];
      const exactJobs = await tx.$queryRaw<LockedBackgroundJob[]>(Prisma.sql`
        SELECT "id", "kind", "idempotencyKey", "status", "payload"
        FROM "BackgroundJob"
        WHERE "idempotencyKey" IN (${Prisma.join(exactJobKeys)})
        ORDER BY "id"
        FOR UPDATE
      `);
      const fulfillmentIds = fulfillmentRows.map((row) => row.id);
      const supplierJobs = fulfillmentIds.length
        ? await tx.$queryRaw<LockedBackgroundJob[]>(Prisma.sql`
            SELECT "id", "kind", "idempotencyKey", "status", "payload"
            FROM "BackgroundJob"
            WHERE "kind" = 'SUPPLIER_ORDER_EMAIL'
              AND "payload"->>'fulfillmentId' IN (${Prisma.join(fulfillmentIds)})
            ORDER BY "id"
            FOR UPDATE
          `)
        : [];
      const jobs = [...exactJobs, ...supplierJobs];
      if (
        jobs.some(
          (job) =>
            job.status === "RUNNING" &&
            ["BUYER_RECEIPT", "FISCAL_RECEIPT"].includes(job.kind),
        )
      ) {
        throw new Error(
          "Dokument porudžbine se upravo obrađuje. Sačekajte završetak i pokušajte ponovo.",
        );
      }

      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: {
          payments: true,
          paymentRefunds: { select: { id: true } },
          fiscal: { select: { id: true } },
          fiscalDocuments: {
            where: { kind: "SALE" },
            select: { id: true },
          },
          shipments: {
            where: {
              purpose: "ORDER_DELIVERY",
              status: { not: "FAILED" },
            },
            select: { id: true },
          },
          dispatchNotes: {
            where: { status: { not: "CANCELLED" } },
            select: { id: true },
          },
          pickupBatchLines: {
            where: { batch: { status: { not: "CANCELLED" } } },
            select: { id: true },
          },
          reclamations: { select: { id: true } },
          items: {
            orderBy: { id: "asc" },
            include: {
              stockMovements: { select: { qty: true } },
              dispatchNoteItems: {
                where: { dispatchNote: { status: { not: "CANCELLED" } } },
                select: { id: true },
              },
              pickupBatchLines: {
                where: { batch: { status: { not: "CANCELLED" } } },
                select: { id: true },
              },
              supplierFulfillmentItem: {
                include: {
                  fulfillment: {
                    select: { id: true, status: true, sentAt: true },
                  },
                },
              },
              product: {
                select: {
                  supplierExternalId: true,
                  supplier: {
                    select: {
                      enabled: true,
                      feedUrl: true,
                      integrationKey: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!order) throw new Error("Porudžbina ne postoji.");
      if (order.updatedAt.getTime() !== preview.updatedAt.getTime()) {
        throw new Error(
          "Porudžbina je u međuvremenu promenjena. Osvežite stranicu i pokušajte ponovo.",
        );
      }
      assertOrderIsEditable(order);

      const item = order.items.find((candidate) => candidate.id === input.orderItemId);
      if (!item) throw new Error("Stavka više ne postoji.");
      if (input.newQty >= item.qty) {
        throw new Error("Količina može samo da se smanji.");
      }
      if (input.newQty === 0 && order.items.length === 1) {
        throw new Error(
          "Poslednja stavka se ne uklanja pojedinačno; otkažite celu porudžbinu.",
        );
      }

      const legacyWarehouseDebited =
        item.stockMovements.reduce((sum, movement) => sum + movement.qty, 0) < 0;
      const reduction = planWebOrderQuantityReduction({
        currentQty: item.qty,
        newQty: input.newQty,
        warehouseReservedQty: item.warehouseReservedQty,
        supplierReservedQty: item.supplierReservedQty,
        legacyWarehouseDebited,
      });

      const fulfillment = item.supplierFulfillmentItem?.fulfillment ?? null;
      if (reduction.supplierReleaseQty > 0) {
        const fulfillmentJobs = supplierJobs.filter(
          (job) =>
            String(
              job.payload &&
                typeof job.payload === "object" &&
                !Array.isArray(job.payload)
                ? job.payload.fulfillmentId ?? ""
                : "",
            ) === fulfillment?.id,
        );
        if (
          !fulfillment ||
          fulfillment.status !== "PENDING" ||
          fulfillment.sentAt ||
          !fulfillmentJobs.length ||
          fulfillmentJobs.some((job) => !jobCanStillReadUpdatedOrder(job))
        ) {
          throw new Error(
            "Dobavljačka rezervacija je već poslata ili se obrađuje; prvo je usaglasite sa dobavljačem.",
          );
        }
      }

      const genericJob = exactJobs.find(
        (job) => job.idempotencyKey === `supplier-reservation:${input.orderId}`,
      );
      if (
        genericSupplierCallbackConfigured(item) &&
        !jobCanStillReadUpdatedOrder(genericJob)
      ) {
        throw new Error(
          "Rezervacija je već poslata dobavljaču; količinu nije bezbedno automatski promeniti.",
        );
      }

      const nextLines = order.items.flatMap((line) => {
        const qty = line.id === item.id ? input.newQty : line.qty;
        return qty > 0
          ? [
              {
                id: line.id,
                productId: line.productId,
                sku: line.sku,
                qty,
                unitPriceFull: num(line.unitPriceFull),
                unitPriceSale: num(line.unitPriceSale),
                assemblyPrice: line.assemblyPrice
                  ? num(line.assemblyPrice)
                  : null,
                supplierIntegrationKey: line.supplierIntegrationKey,
              },
            ]
          : [];
      });
      const preliminary = calculateEditedWebOrderTotals({
        lines: nextLines,
        shipping: quotedShipping,
        keepFirstPurchaseDiscount: num(order.firstPurchaseDiscount) > 0,
        keepSavedCardDiscount: num(order.savedCardDiscount) > 0,
      });
      const requestedVoucherDiscount = await lockedVoucherDiscount(
        tx,
        order.voucherCode,
        preliminary.subtotal,
      );
      const totals = calculateEditedWebOrderTotals({
        lines: nextLines,
        shipping: quotedShipping,
        requestedVoucherDiscount,
        keepFirstPurchaseDiscount: num(order.firstPurchaseDiscount) > 0,
        keepSavedCardDiscount: num(order.savedCardDiscount) > 0,
      });

      if (reduction.supplierReleaseQty > 0) {
        if (!item.productId || !item.supplierFulfillmentItem || !fulfillment) {
          throw new Error("Dobavljačka rezervacija stavke nije potpuna.");
        }
        const released = await tx.product.updateMany({
          where: {
            id: item.productId,
            supplierReservedStock: { gte: reduction.supplierReleaseQty },
          },
          data: {
            supplierReservedStock: {
              decrement: reduction.supplierReleaseQty,
            },
          },
        });
        if (released.count !== 1) {
          throw new Error("Dobavljačka rezervacija se ne poklapa sa stanjem proizvoda.");
        }
        if (reduction.nextSupplierReservedQty > 0) {
          await tx.supplierFulfillmentItem.update({
            where: { id: item.supplierFulfillmentItem.id },
            data: { qty: reduction.nextSupplierReservedQty },
          });
        } else {
          await tx.supplierFulfillmentItem.delete({
            where: { id: item.supplierFulfillmentItem.id },
          });
          const remainingSupplierLines = await tx.supplierFulfillmentItem.count({
            where: { fulfillmentId: fulfillment.id },
          });
          if (!remainingSupplierLines) {
            await tx.supplierFulfillment.update({
              where: { id: fulfillment.id },
              data: { status: "CANCELLED", cancelledAt: new Date() },
            });
          }
        }
      }

      if (reduction.restorePhysicalWarehouseQty > 0) {
        if (!item.productId) {
          throw new Error("Proizvod stavke nije dostupan za povrat lagera.");
        }
        await adjustInventory(tx, {
          idempotencyKey: `web-order-edit:${operationKey}:${item.id}`,
          productId: item.productId,
          warehouseId: item.warehouseId ?? undefined,
          sku: item.sku,
          qtyDelta: reduction.restorePhysicalWarehouseQty,
          kind: "ADJUSTMENT",
          orderId: order.id,
          orderItemId: item.id,
          actorId: input.actorId,
          note: `Smanjenje WEB porudžbine ${order.number}: ${item.sku} ${item.qty} → ${input.newQty}`,
        });
      }

      if (input.newQty === 0) {
        await tx.orderItem.delete({ where: { id: item.id } });
      } else {
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            qty: input.newQty,
            warehouseReservedQty: reduction.nextWarehouseReservedQty,
            supplierReservedQty: reduction.nextSupplierReservedQty,
          },
        });
      }
      if (item.productId) {
        await syncProductChannelAvailability(tx, item.productId);
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          subtotal: decimal(totals.subtotal),
          savings: decimal(totals.savings),
          shipping: decimal(totals.shipping),
          assemblyTotal: decimal(totals.assemblyTotal),
          voucherDiscount: order.voucherCode
            ? decimal(totals.voucherDiscount)
            : null,
          firstPurchaseDiscount: num(order.firstPurchaseDiscount) > 0
            ? decimal(totals.firstPurchaseDiscount)
            : null,
          savedCardDiscount: num(order.savedCardDiscount) > 0
            ? decimal(totals.savedCardDiscount)
            : null,
          total: decimal(totals.total),
        },
      });
      await tx.payment.updateMany({
        where: {
          orderId: order.id,
          status: "PENDING",
          provider: { in: ["MANUAL", "COD"] },
        },
        data: { amount: decimal(totals.total) },
      });
      await tx.checkoutSession.updateMany({
        where: { orderId: order.id },
        data: {
          lineCount: nextLines.length,
          itemQty: nextLines.reduce((sum, line) => sum + line.qty, 0),
          cartTotal: decimal(totals.total),
        },
      });
      if (order.voucherCode) {
        await tx.voucherRedemption.updateMany({
          where: { orderId: order.id },
          data: { amount: decimal(totals.voucherDiscount) },
        });
      }

      if (genericJob && jobCanStillReadUpdatedOrder(genericJob)) {
        const genericLines = nextLines.flatMap((line) =>
          line.productId && line.supplierIntegrationKey !== "RABALUX"
            ? [{ productId: line.productId, qty: line.qty }]
            : [],
        );
        await tx.backgroundJob.update({
          where: { id: genericJob.id },
          data: genericLines.length
            ? {
                payload: {
                  orderNumber: order.number,
                  lines: genericLines,
                },
              }
            : {
                status: "COMPLETED",
                payload: {},
                completedAt: new Date(),
                lockedAt: null,
                lastError: null,
              },
        });
      }

      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          status: order.status,
          actorId: input.actorId,
          note: `WEB stavka ${item.sku} promenjena: ${item.qty} → ${input.newQty}. Kupcu dokument nije automatski poslat.`,
        },
      });

      return {
        orderId: order.id,
        orderNumber: order.number,
        itemId: item.id,
        sku: item.sku,
        previousQty: item.qty,
        newQty: input.newQty,
        totals,
      };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );

  let receiptRefreshed = false;
  let receiptError: string | null = null;
  try {
    const receipt = await issueBuyerReceiptForOrder(result.orderId, {
      sendEmail: false,
      invalidateExistingPdfOnUploadFailure: true,
    });
    receiptRefreshed = receipt.ok;
    receiptError = receipt.ok ? null : receipt.error;
    if (receipt.ok) {
      await db.invoice.update({
        where: { id: receipt.invoiceId },
        data: {
          status: "ISSUED",
          emailedAt: null,
          emailError: null,
        },
      });
    }
  } catch (error) {
    receiptError = error instanceof Error ? error.message : "Nepoznata greška.";
  }

  return { ...result, receiptRefreshed, receiptError };
}
