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
  enqueueBackgroundJob,
  processBackgroundJob,
} from "@/lib/background-jobs";
import { allocateStock } from "@/lib/rabalux/allocation";
import {
  RABALUX_SUPPLIER_SAFETY_STOCK,
  resolveRabaluxAvailability,
} from "@/lib/rabalux/availability";
import { isRabaluxSupplierOperational } from "@/lib/rabalux/config";
import { isCashOnDeliveryPaymentMethod } from "@/lib/payments/fulfillment-readiness";
import { effectiveUnitPrice } from "@/lib/pricing";
import {
  getActivePricingRules,
  pricingRuleInputsForProduct,
} from "@/lib/pricing/rules";
import { resolveRetailPrice } from "@/lib/pricing/retail-price";
import { getMediaVariantUrl } from "@/lib/media";
import { normalizeProductColorLabel } from "@/lib/product-colors";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import {
  isProductAvailableOnWeb,
  webStorefrontProductWhere,
} from "@/lib/web-storefront-availability";
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

const editableWebProductSelect = {
  id: true,
  sku: true,
  name: true,
  shortDescription: true,
  sizeLabel: true,
  colorPrimary: true,
  colorSecondary: true,
  isActive: true,
  deletedAt: true,
  availableWebManual: true,
  availableWebAuto: true,
  articleStatus: true,
  stock: true,
  dcAvailableQty: true,
  supplierStock: true,
  supplierReservedStock: true,
  supplierApprovalStatus: true,
  lastSupplierStockSyncAt: true,
  fullPrice: true,
  salePrice: true,
  discountPct: true,
  action: {
    select: {
      name: true,
      startsAt: true,
      endsAt: true,
      isPermanent: true,
    },
  },
  actionPrices: {
    include: {
      action: {
        select: {
          id: true,
          name: true,
          priority: true,
          startsAt: true,
          endsAt: true,
          isPermanent: true,
        },
      },
    },
  },
  priceListEntries: {
    where: { priceList: { kind: "RETAIL" as const } },
    include: {
      priceList: {
        select: {
          id: true,
          name: true,
          code: true,
          active: true,
          validFrom: true,
          validTo: true,
        },
      },
    },
  },
  supplierId: true,
  supplierExternalId: true,
  supplier: {
    select: {
      id: true,
      name: true,
      integrationKey: true,
      enabled: true,
      fulfillmentMode: true,
      feedUrl: true,
    },
  },
  groupId: true,
  group: { select: { name: true } },
  collection: { select: { name: true } },
  categories: {
    orderBy: { category: { level: "asc" as const } },
    select: {
      categoryId: true,
      category: { select: { name: true, path: true } },
    },
  },
  media: {
    where: { kind: "IMAGE" as const },
    orderBy: { order: "asc" as const },
    take: 1,
  },
} satisfies Prisma.ProductSelect;

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
  const currentPayments = order.payments.filter(
    (payment) => payment.status !== "FAILED",
  );
  const unsafePayment = currentPayments.find(
    (payment) =>
      payment.status !== "PENDING" ||
      !["MANUAL", "COD"].includes(payment.provider) ||
      Boolean(
        payment.providerRef ||
          payment.paymentReference ||
          payment.redirectUrl,
      ),
  );
  if (!currentPayments.length || unsafePayment) {
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

async function refreshBuyerReceipt(orderId: string) {
  let receiptRefreshed = false;
  let receiptError: string | null = null;
  try {
    const receipt = await issueBuyerReceiptForOrder(orderId, {
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
  return { receiptRefreshed, receiptError };
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
          note: `WEB stavka ${item.sku} promenjena: ${item.qty} → ${input.newQty}. Obaveštenje kupcu je zakazano.`,
        },
      });

      await enqueueBackgroundJob(
        {
          kind: "ORDER_ITEMS_CHANGED_EMAIL",
          payload: {
            orderId: order.id,
            itemName: item.name,
            sku: item.sku,
            previousQty: item.qty,
            newQty: input.newQty,
            operationKey,
          },
          idempotencyKey: `order-items-changed-job:${order.id}:${operationKey}`,
        },
        tx,
      );

      return {
        orderId: order.id,
        orderNumber: order.number,
        itemId: item.id,
        sku: item.sku,
        itemName: item.name,
        previousQty: item.qty,
        newQty: input.newQty,
        totals,
      };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );

  const { receiptRefreshed, receiptError } = await refreshBuyerReceipt(
    result.orderId,
  );

  return {
    ...result,
    receiptRefreshed,
    receiptError,
    customerNotificationQueued: true,
  };
}

export async function addWebOrderItem(input: {
  orderId: string;
  sku: string;
  qty: number;
  actorId: string;
}) {
  const requestedSku = input.sku.trim();
  if (!input.orderId || !requestedSku) {
    throw new Error("Nedostaje porudžbina ili šifra artikla.");
  }
  if (!Number.isInteger(input.qty) || input.qty <= 0 || input.qty > 999) {
    throw new Error("Količina mora biti ceo broj od 1 do 999.");
  }

  const productRef = await db.product.findFirst({
    where: { sku: { equals: requestedSku, mode: "insensitive" } },
    select: { id: true, sku: true },
  });
  if (!productRef) throw new Error("Artikal sa unetom šifrom ne postoji.");

  const preview = await db.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      updatedAt: true,
      userId: true,
      shipCity: true,
      shippingMethod: true,
      items: {
        orderBy: { id: "asc" },
        select: { id: true, sku: true, qty: true },
      },
    },
  });
  if (!preview) throw new Error("Porudžbina ne postoji.");
  const previewMatches = preview.items.filter(
    (item) => item.sku === productRef.sku,
  );
  if (previewMatches.length > 1) {
    throw new Error(
      "Porudžbina već ima više redova sa ovom šifrom; prvo ih ručno usaglasite.",
    );
  }
  const previewTarget = previewMatches[0] ?? null;
  const previewLines = preview.items.map((item) => ({
    sku: item.sku,
    qty: item.qty + (item.id === previewTarget?.id ? input.qty : 0),
  }));
  if (!previewTarget) {
    previewLines.push({ sku: productRef.sku, qty: input.qty });
  }
  const deliveryQuote = await resolveDeliveryQuote({
    city: preview.shipCity,
    lines: previewLines,
    loggedIn: Boolean(preview.userId),
  });
  const quotedShipping =
    preview.shippingMethod === "KURIR"
      ? deliveryQuote.prices.kurir
      : deliveryQuote.prices.kamion;
  if (quotedShipping == null) {
    throw new Error(
      "Izabrani način dostave nije dostupan kada se ovaj artikal doda.",
    );
  }

  const activePricingRules = await getActivePricingRules();
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
            WHERE "kind" IN ('SUPPLIER_ORDER_EMAIL', 'SUPPLIER_SHIPPING_DOCUMENTS_EMAIL')
              AND "payload"->>'fulfillmentId' IN (${Prisma.join(fulfillmentIds)})
            ORDER BY "id"
            FOR UPDATE
          `)
        : [];
      if (
        exactJobs.some(
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
          supplierFulfillments: {
            include: { items: true },
          },
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

      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Product" WHERE "id" = ${productRef.id} FOR UPDATE`,
      );
      const product = await tx.product.findUnique({
        where: { id: productRef.id },
        select: editableWebProductSelect,
      });
      if (!product || product.sku !== productRef.sku) {
        throw new Error("Artikal više ne postoji.");
      }
      const currentAvailability = await syncProductChannelAvailability(
        tx,
        product.id,
      );
      const published = await tx.product.count({
        where: {
          AND: [{ id: product.id }, webStorefrontProductWhere()],
        },
      });
      if (!published) {
        throw new Error(
          "Artikal trenutno nije objavljen i dostupan za WEB prodaju.",
        );
      }
      if (
        !isProductAvailableOnWeb({
          ...product,
          dcAvailableQty: currentAvailability.dcAvailable,
          availableWebAuto: currentAvailability.webAuto,
        })
      ) {
        throw new Error("Artikal trenutno nije dostupan za WEB prodaju.");
      }

      const defaultDc = await tx.warehouse.findFirst({
        where: { active: true, isDefault: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      const rabaluxAvailability = resolveRabaluxAvailability({
        warehouseStock: currentAvailability.dcAvailable,
        supplierStock: product.supplierStock,
        supplierReservedStock: product.supplierReservedStock,
        lastSupplierStockSyncAt: product.lastSupplierStockSyncAt,
        supplierOperational: isRabaluxSupplierOperational(product.supplier),
        supplierApproved: product.supplierApprovalStatus === "APPROVED",
      });
      const allocation =
        product.supplier?.integrationKey === "RABALUX" &&
        rabaluxAvailability.supplierEligible
          ? allocateStock(input.qty, {
              // Rabalux WEB prodaja koristi isključivo poslednji odobreni
              // Serbia XLSX lager; DC stanje ne prebacuje ovu stavku u DC tok.
              warehouseStock: 0,
              supplierStock: product.supplierStock,
              supplierReservedStock: product.supplierReservedStock,
              supplierSafetyStock: RABALUX_SUPPLIER_SAFETY_STOCK,
            })
          : currentAvailability.dcAvailable >= input.qty
            ? { warehouseQty: input.qty, supplierQty: 0 }
            : null;
      if (!allocation) {
        throw new Error(
          `Nema dovoljno raspoložive količine za ${product.sku}.`,
        );
      }
      if (allocation.warehouseQty > 0 && !defaultDc) {
        throw new Error(
          "Podrazumevani DC magacin nije podešen; artikal ne može bezbedno da se rezerviše.",
        );
      }

      const matchingItems = order.items.filter(
        (item) => item.sku === product.sku,
      );
      if (matchingItems.length > 1) {
        throw new Error(
          "Porudžbina već ima više redova sa ovom šifrom; prvo ih ručno usaglasite.",
        );
      }
      const existingItem = matchingItems[0] ?? null;
      if (existingItem && existingItem.productId !== product.id) {
        throw new Error(
          "Postojeća stavka nije povezana sa aktuelnim matičnim artiklom.",
        );
      }
      if (
        existingItem &&
        (existingItem.supplierIntegrationKey ?? null) !==
          (product.supplier?.integrationKey ?? null)
      ) {
        throw new Error(
          "Dobavljač artikla je promenjen od kreiranja porudžbine; povećanje je blokirano radi provere.",
        );
      }
      if (
        existingItem?.warehouseId &&
        allocation.warehouseQty > 0 &&
        existingItem.warehouseId !== defaultDc?.id
      ) {
        throw new Error(
          "Postojeća stavka je rezervisana u drugom magacinu i ne može automatski da se poveća.",
        );
      }

      const genericJob = exactJobs.find(
        (job) => job.idempotencyKey === `supplier-reservation:${input.orderId}`,
      );
      const genericCallbackIsConfigured = genericSupplierCallbackConfigured({
        supplierIntegrationKey: product.supplier?.integrationKey ?? null,
        supplierExternalSku: product.supplierExternalId,
        product: {
          supplierExternalId: product.supplierExternalId,
          supplier: product.supplier
            ? {
                enabled: product.supplier.enabled,
                feedUrl: product.supplier.feedUrl,
                integrationKey: product.supplier.integrationKey,
              }
            : null,
        },
      });
      if (
        genericCallbackIsConfigured &&
        genericJob &&
        !jobCanStillReadUpdatedOrder(genericJob)
      ) {
        throw new Error(
          "Rezervacija je već poslata dobavljaču; artikal nije bezbedno automatski dodati.",
        );
      }

      let unitPriceFull: number;
      let unitPriceSale: number;
      if (existingItem) {
        unitPriceFull = num(existingItem.unitPriceFull);
        unitPriceSale = num(existingItem.unitPriceSale);
      } else {
        const retailPrice = resolveRetailPrice(
          product.priceListEntries,
          product.fullPrice,
        );
        const ruleInputs = pricingRuleInputsForProduct(
          {
            id: product.id,
            categoryIds: product.categories.map((item) => item.categoryId),
            categoryPaths: product.categories.map(
              (item) => item.category.path,
            ),
            groupId: product.groupId,
          },
          activePricingRules,
        );
        const price = effectiveUnitPrice({
          fullPrice: retailPrice.price,
          salePrice: product.salePrice ? num(product.salePrice) : null,
          discountPct: product.discountPct,
          loyaltyPrice: null,
          loyaltyDiscountPct: ruleInputs.loyaltyDiscountPct,
          loyaltyEligible: Boolean(order.userId),
          action: product.action,
          actionPrices: product.actionPrices.map((entry) => ({
            price: num(entry.salePrice),
            priority: entry.action.priority,
            startsAt: entry.action.startsAt,
            endsAt: entry.action.endsAt,
            isPermanent: entry.action.isPermanent,
            actionId: entry.action.id,
            actionName: entry.action.name,
          })),
          linearPromotions: ruleInputs.linearPromotions,
        });
        unitPriceFull = price.full;
        unitPriceSale = price.effective;
        if (unitPriceFull <= 0 || unitPriceSale <= 0) {
          throw new Error("Artikal nema ispravnu važeću WEB cenu.");
        }
      }

      const primaryCategory = product.categories.at(-1)?.category ?? null;
      const previousQty = existingItem?.qty ?? 0;
      const nextQty = previousQty + input.qty;
      const orderItem = existingItem
        ? await tx.orderItem.update({
            where: { id: existingItem.id },
            data: {
              qty: nextQty,
              warehouseId:
                allocation.warehouseQty > 0
                  ? (existingItem.warehouseId ?? defaultDc!.id)
                  : existingItem.warehouseId,
              warehouseReservedQty: { increment: allocation.warehouseQty },
              supplierReservedQty: { increment: allocation.supplierQty },
            },
            select: { id: true },
          })
        : await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: product.id,
              sku: product.sku,
              name: product.name,
              qty: nextQty,
              unitPriceFull: decimal(unitPriceFull),
              unitPriceSale: decimal(unitPriceSale),
              withAssembly: false,
              assemblyPrice: null,
              thumbnailUrl:
                resolveSupabaseStorageUrl(
                  getMediaVariantUrl(product.media[0], "thumb"),
                ) || null,
              supplierName: product.supplier?.name ?? null,
              supplierIntegrationKey:
                product.supplier?.integrationKey ?? null,
              categoryName: primaryCategory?.name ?? null,
              categoryPath: primaryCategory?.path ?? null,
              groupName: product.group?.name ?? null,
              subgroupName: primaryCategory?.path ?? null,
              collectionName: product.collection?.name ?? null,
              shortDescriptionSnapshot: product.shortDescription ?? null,
              shortNameSnapshot: product.name,
              attribute1: product.sizeLabel ?? null,
              attribute2: normalizeProductColorLabel(product.colorPrimary),
              attribute3: normalizeProductColorLabel(product.colorSecondary),
              attribute4: null,
              color1: normalizeProductColorLabel(product.colorPrimary),
              color2: normalizeProductColorLabel(product.colorSecondary),
              warehouseId:
                allocation.warehouseQty > 0 ? defaultDc!.id : null,
              warehouseReservedQty: allocation.warehouseQty,
              supplierReservedQty: allocation.supplierQty,
              supplierExternalSku: product.supplierExternalId ?? null,
            },
            select: { id: true },
          });

      const supplierJobIds: string[] = [];
      if (allocation.supplierQty > 0) {
        if (
          !product.supplierId ||
          !product.supplierExternalId ||
          product.supplier?.fulfillmentMode !== "EMAIL"
        ) {
          throw new Error(
            "Dobavljačka rezervacija artikla nije potpuno podešena.",
          );
        }
        const reserved = await tx.product.updateMany({
          where: { id: product.id },
          data: {
            supplierReservedStock: { increment: allocation.supplierQty },
          },
        });
        if (reserved.count !== 1) {
          throw new Error("Dobavljačka rezervacija nije sačuvana.");
        }

        let fulfillment = order.supplierFulfillments.find(
          (candidate) => candidate.supplierId === product.supplierId,
        );
        if (
          fulfillment &&
          (fulfillment.sentAt ||
            !["PENDING", "CANCELLED"].includes(fulfillment.status))
        ) {
          throw new Error(
            "Porudžbina dobavljaču je već poslata ili obrađena; novi artikal ne može automatski da se doda.",
          );
        }
        const existingFulfillmentJobs = fulfillment
          ? supplierJobs.filter(
              (job) =>
                String(
                  job.payload &&
                    typeof job.payload === "object" &&
                    !Array.isArray(job.payload)
                    ? job.payload.fulfillmentId ?? ""
                    : "",
                ) === fulfillment?.id,
            )
          : [];
        if (
          existingFulfillmentJobs.some((job) => job.status === "RUNNING")
        ) {
          throw new Error(
            "Porudžbina dobavljaču se upravo obrađuje. Sačekajte i pokušajte ponovo.",
          );
        }

        if (!fulfillment) {
          const created = await tx.supplierFulfillment.create({
            data: {
              orderId: order.id,
              supplierId: product.supplierId,
            },
            include: { items: true },
          });
          fulfillment = created;
        } else if (fulfillment.status === "CANCELLED") {
          await tx.supplierFulfillment.update({
            where: { id: fulfillment.id },
            data: {
              status: "PENDING",
              cancelledAt: null,
              lastError: null,
            },
          });
        }

        const fulfillmentItem = fulfillment.items.find(
          (item) => item.orderItemId === orderItem.id,
        );
        if (existingItem?.supplierReservedQty && !fulfillmentItem) {
          throw new Error("Dobavljačka rezervacija postojeće stavke nije potpuna.");
        }
        if (fulfillmentItem) {
          await tx.supplierFulfillmentItem.update({
            where: { id: fulfillmentItem.id },
            data: { qty: { increment: allocation.supplierQty } },
          });
        } else {
          await tx.supplierFulfillmentItem.create({
            data: {
              fulfillmentId: fulfillment.id,
              orderItemId: orderItem.id,
              productId: product.id,
              externalSku: product.supplierExternalId,
              qty: allocation.supplierQty,
            },
          });
        }

        if (
          !existingFulfillmentJobs.some((job) =>
            jobCanStillReadUpdatedOrder(job),
          )
        ) {
          const supplierJob = await enqueueBackgroundJob(
            {
              kind: isCashOnDeliveryPaymentMethod(order.paymentMethod)
                ? "SUPPLIER_SHIPPING_DOCUMENTS_EMAIL"
                : "SUPPLIER_ORDER_EMAIL",
              payload: {
                fulfillmentId: fulfillment.id,
                dispatchKey: `web-edit-${operationKey}`,
              },
              idempotencyKey: `supplier-web-edit:${fulfillment.id}:${operationKey}`,
            },
            tx,
          );
          supplierJobIds.push(supplierJob.id);
        }
      }

      const legacyWarehouseDebited = Boolean(
        existingItem &&
          existingItem.stockMovements.reduce(
            (sum, movement) => sum + movement.qty,
            0,
          ) < 0,
      );
      if (legacyWarehouseDebited && allocation.warehouseQty > 0) {
        await adjustInventory(tx, {
          idempotencyKey: `web-order-edit:${operationKey}:${orderItem.id}`,
          productId: product.id,
          warehouseId: existingItem?.warehouseId ?? defaultDc!.id,
          sku: product.sku,
          qtyDelta: -allocation.warehouseQty,
          kind: "ADJUSTMENT",
          orderId: order.id,
          orderItemId: orderItem.id,
          actorId: input.actorId,
          note: `Povećanje legacy WEB porudžbine ${order.number}: ${product.sku} ${previousQty} → ${nextQty}`,
        });
      }

      const nextLines = order.items.map((line) =>
        line.id === existingItem?.id
          ? {
              id: line.id,
              productId: line.productId,
              sku: line.sku,
              qty: nextQty,
              unitPriceFull,
              unitPriceSale,
              assemblyPrice: line.assemblyPrice
                ? num(line.assemblyPrice)
                : null,
              supplierIntegrationKey: line.supplierIntegrationKey,
            }
          : {
              id: line.id,
              productId: line.productId,
              sku: line.sku,
              qty: line.qty,
              unitPriceFull: num(line.unitPriceFull),
              unitPriceSale: num(line.unitPriceSale),
              assemblyPrice: line.assemblyPrice
                ? num(line.assemblyPrice)
                : null,
              supplierIntegrationKey: line.supplierIntegrationKey,
            },
      );
      if (!existingItem) {
        nextLines.push({
          id: orderItem.id,
          productId: product.id,
          sku: product.sku,
          qty: nextQty,
          unitPriceFull,
          unitPriceSale,
          assemblyPrice: null,
          supplierIntegrationKey: product.supplier?.integrationKey ?? null,
        });
      }

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

      await syncProductChannelAvailability(tx, product.id);
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

      const genericLines = nextLines.flatMap((line) =>
        line.productId && line.supplierIntegrationKey !== "RABALUX"
          ? [{ productId: line.productId, qty: line.qty }]
          : [],
      );
      if (genericJob && jobCanStillReadUpdatedOrder(genericJob)) {
        await tx.backgroundJob.update({
          where: { id: genericJob.id },
          data: {
            payload: {
              orderNumber: order.number,
              lines: genericLines,
            },
          },
        });
      } else if (!genericJob && genericCallbackIsConfigured) {
        await enqueueBackgroundJob(
          {
            kind: "SUPPLIER_RESERVATION",
            payload: {
              orderNumber: order.number,
              lines: genericLines,
            },
            idempotencyKey: `supplier-reservation:${order.id}`,
          },
          tx,
        );
      }

      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          status: order.status,
          actorId: input.actorId,
          note:
            previousQty > 0
              ? `WEB stavka ${product.sku} povećana: ${previousQty} → ${nextQty}. Obaveštenje kupcu je zakazano.`
              : `WEB stavka ${product.sku} dodata u količini ${nextQty}. Obaveštenje kupcu je zakazano.`,
        },
      });
      await enqueueBackgroundJob(
        {
          kind: "ORDER_ITEMS_CHANGED_EMAIL",
          payload: {
            orderId: order.id,
            itemName: product.name,
            sku: product.sku,
            previousQty,
            newQty: nextQty,
            operationKey,
          },
          idempotencyKey: `order-items-changed-job:${order.id}:${operationKey}`,
        },
        tx,
      );

      return {
        orderId: order.id,
        orderNumber: order.number,
        itemId: orderItem.id,
        sku: product.sku,
        itemName: product.name,
        previousQty,
        newQty: nextQty,
        totals,
        supplierJobIds,
      };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );

  await Promise.allSettled(
    result.supplierJobIds.map((jobId) => processBackgroundJob(jobId)),
  );
  const { receiptRefreshed, receiptError } = await refreshBuyerReceipt(
    result.orderId,
  );
  return {
    ...result,
    receiptRefreshed,
    receiptError,
    customerNotificationQueued: true,
  };
}
