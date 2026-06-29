import "server-only";
import { Prisma, type PaymentMethod, type ShippingMethod } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import { validateVoucher } from "@/lib/api/vouchers";
import { clearServerCart } from "@/lib/api/cart";
import { notifySuppliersOfReservation } from "@/lib/xml";
import { providerForPaymentMethod } from "@/lib/payments";
import { createOrderAccessToken, hashOrderAccessToken } from "@/lib/api/order-access";
import { issueBuyerReceiptForOrder } from "@/lib/receipts";
import {
  computeOrderPricing,
  type PricingLine,
} from "@/lib/pricing";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import { getSmallParcelProvider, MYGLS_PROVIDER } from "@/lib/mygls";
import {
  isPaymentMethodEnabled,
  resolveDeliveryQuote,
} from "@/lib/checkout/config";

/**
 * Order creation (Phase 3C — item 3 of plan).
 *
 * Wraps everything in a Postgres transaction:
 *   1. Re-fetch each line item's product → authoritative price + stock.
 *   2. Reject if any product is inactive or insufficient stock.
 *   3. Recompute subtotal, savings, assembly, shipping (basic; full delivery
 *      rule resolution is Phase 3D), voucher, total. Never trust client totals.
 *   4. Allocate human number (`SPC-{year}-{seq}` — sequential per year).
 *   5. Create Order + OrderItems + initial Payment + initial status event.
 *   6. Decrement stock; the supplier reservation callback fires in 4A.
 *   7. Record voucher redemption if applied.
 *   8. Clear logged-in cart mirror.
 *
 * The pricing engine in 3D will replace the inline `effectivePrice` helpers.
 */

const lineSchema = z.object({
  sku: z.string().min(1),
  qty: z.int().min(1).max(99),
  withAssembly: z.boolean().optional(),
});

const addressSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  phone: z.string().min(8).max(32),
  street: z.string().min(3),
  city: z.string().min(2),
  postalCode: z.string().regex(/^\d{5}$/),
  country: z.string().default("RS"),
  companyName: z.string().optional(),
  pib: z.string().regex(/^\d{9}$/).optional(),
});

export const createOrderSchema = z.object({
  checkoutSessionId: z
    .string()
    .min(12)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  guestEmail: z.email().optional(),
  lines: z.array(lineSchema).min(1).max(50),
  shipping: addressSchema,
  billingSameAsShipping: z.boolean().default(true),
  billing: addressSchema.optional(),
  shippingMethod: z.enum(["KURIR", "KAMION"]),
  glsDeliveryPoint: z
    .object({
      code: z.string().min(1),
      name: z.string().min(1),
      street: z.string().optional().nullable(),
      city: z.string().optional().nullable(),
      postalCode: z.string().optional().nullable(),
      label: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  paymentMethod: z.enum([
    "IPS",
    "KARTICA",
    "GOOGLE_PAY",
    "APPLE_PAY",
    "UPLATA_NA_RACUN",
    "POUZECE_GOTOVINA",
    "POUZECE_KARTICA",
  ]),
  voucherCode: z.string().trim().optional(),
  /** Pay with a tokenized saved card (eligible only for logged-in users). */
  useSavedCard: z.boolean().optional(),
  notes: z.string().max(500).optional(),
  consent: z.literal(true),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export type CreateOrderError =
  | { code: "EMPTY_CART" }
  | { code: "OUT_OF_STOCK"; sku: string }
  | { code: "INACTIVE"; sku: string }
  | { code: "VOUCHER_INVALID"; reason: string }
  | { code: "GUEST_REQUIRES_EMAIL" }
  | { code: "DELIVERY_POINT_INVALID" }
  | { code: "PAYMENT_UNAVAILABLE" }
  | { code: "DELIVERY_UNAVAILABLE" };

export interface CreateOrderResult {
  number: string;
  id: string;
  accessToken: string;
  total: number;
  paymentMethod: PaymentMethod;
  shippingMethod: ShippingMethod;
}

class StockReservationError extends Error {
  constructor(readonly sku: string) {
    super(`Insufficient stock for ${sku}`);
  }
}

async function nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SPC-${year}-`;
  const last = await tx.order.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const seq = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(6, "0")}`;
}

function isOnlinePayment(method: PaymentMethod) {
  return (
    method === "IPS" ||
    method === "KARTICA" ||
    method === "GOOGLE_PAY" ||
    method === "APPLE_PAY"
  );
}

function paymentExpiresAt(method: PaymentMethod) {
  if (!isOnlinePayment(method)) return null;
  const minutes = Math.min(
    Math.max(Number(process.env.PAYMENT_PENDING_EXPIRY_MINUTES ?? 45) || 45, 5),
    24 * 60,
  );
  return new Date(Date.now() + minutes * 60_000);
}

export async function createOrder(
  input: CreateOrderInput,
  userId: string | null,
): Promise<{ ok: true; data: CreateOrderResult } | { ok: false; error: CreateOrderError }> {
  if (!userId && !input.guestEmail) {
    return { ok: false, error: { code: "GUEST_REQUIRES_EMAIL" } };
  }
  if (!input.lines.length) return { ok: false, error: { code: "EMPTY_CART" } };
  if (!(await isPaymentMethodEnabled(input.paymentMethod))) {
    return { ok: false, error: { code: "PAYMENT_UNAVAILABLE" } };
  }

  const skus = input.lines.map((l) => l.sku);
  const products = await db.product.findMany({
    where: { sku: { in: skus } },
    select: {
      id: true,
      sku: true,
      name: true,
      shortDescription: true,
      sizeLabel: true,
      colorPrimary: true,
      colorSecondary: true,
      isActive: true,
      stock: true,
      fullPrice: true,
      salePrice: true,
      discountPct: true,
      allowsAssembly: true,
      action: { select: { startsAt: true, endsAt: true, name: true } },
      supplier: { select: { name: true } },
      group: { select: { name: true } },
      collection: { select: { name: true } },
      categories: {
        take: 1,
        select: { category: { select: { name: true, path: true } } },
      },
      media: { where: { kind: "IMAGE" }, orderBy: { order: "asc" }, take: 1 },
    },
  });
  const bySku = new Map(products.map((p) => [p.sku, p]));

  // Pre-validate against fresh stock + activity.
  for (const line of input.lines) {
    const p = bySku.get(line.sku);
    if (!p || !p.isActive) return { ok: false, error: { code: "INACTIVE", sku: line.sku } };
    if (p.stock < line.qty) return { ok: false, error: { code: "OUT_OF_STOCK", sku: line.sku } };
  }

  // Project DB rows into the pricing engine shape (Phase 3D — single source
  // of truth for effective price + action-window validation).
  const pricingLines: PricingLine[] = input.lines.map((line) => {
    const p = bySku.get(line.sku)!;
    return {
      sku: line.sku,
      qty: line.qty,
      product: {
        fullPrice: num(p.fullPrice),
        salePrice: p.salePrice ? num(p.salePrice) : null,
        discountPct: p.discountPct,
        action: p.action ?? null,
      },
    };
  });

  const deliveryQuote = await resolveDeliveryQuote({
    city: input.shipping.city,
    lines: input.lines.map((line) => ({ sku: line.sku, qty: line.qty })),
  });
  if (input.shippingMethod === "KAMION" && !deliveryQuote.truckAvailable) {
    return { ok: false, error: { code: "DELIVERY_UNAVAILABLE" } };
  }

  // Per-line assembly is independent of the pricing engine.
  let assemblyTotal = 0;
  const assemblyBySku = new Map<string, number | null>();
  for (const line of input.lines) {
    const p = bySku.get(line.sku)!;
    const wants = !!line.withAssembly && p.allowsAssembly;
    const quotedAssembly =
      deliveryQuote.assemblyPricesBySku[line.sku] ?? deliveryQuote.assemblyPrice;
    const price = wants && quotedAssembly > 0 ? quotedAssembly : null;
    assemblyBySku.set(line.sku, price);
    if (price) assemblyTotal += price * line.qty;
  }

  // Voucher must be validated server-side before passing to the engine so
  // the engine stays pure and DB-free.
  let voucherInput: { code: string; discountRsd: number } | null = null;
  // Use the pre-discount subtotal for voucher's min-subtotal check.
  const preDiscountSubtotal = pricingLines.reduce((n, l) => {
    const sale = l.product.salePrice ?? l.product.fullPrice;
    return n + sale * l.qty;
  }, 0);
  if (input.voucherCode) {
    const v = await validateVoucher(input.voucherCode, preDiscountSubtotal, userId);
    if (!v.ok) return { ok: false, error: { code: "VOUCHER_INVALID", reason: v.reason } };
    voucherInput = { code: v.code, discountRsd: v.discountRsd };
  }

  // Resolve eligibility from the auth context (server-only).
  const firstPurchase = userId
    ? (await db.order.count({ where: { userId } })) === 0
    : false;
  let useSavedCard = false;
  if (input.useSavedCard && userId) {
    const cardCount = await db.savedCard.count({ where: { userId } });
    useSavedCard = cardCount > 0;
  }

  const pricing = computeOrderPricing({
    lines: pricingLines,
    voucher: voucherInput,
    eligibility: { firstPurchase, savedCard: useSavedCard },
  });

  const itemsForCreate: Prisma.OrderItemCreateManyOrderInput[] = pricing.lines.map((r) => {
    const p = bySku.get(r.sku)!;
    const assemblyPrice = assemblyBySku.get(r.sku) ?? null;
    const primaryCategory = p.categories[0]?.category ?? null;
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      qty: r.qty,
      unitPriceFull: new Prisma.Decimal(r.unitPriceFull),
      unitPriceSale: new Prisma.Decimal(r.unitPriceSale),
      withAssembly: assemblyPrice != null,
      assemblyPrice: assemblyPrice ? new Prisma.Decimal(assemblyPrice) : null,
      thumbnailUrl: resolveSupabaseStorageUrl(p.media[0]?.url) || null,
      supplierName: p.supplier?.name ?? null,
      categoryName: primaryCategory?.name ?? null,
      categoryPath: primaryCategory?.path ?? null,
      groupName: p.group?.name ?? null,
      subgroupName: primaryCategory?.path ?? null,
      collectionName: p.collection?.name ?? null,
      shortDescriptionSnapshot: p.shortDescription ?? null,
      shortNameSnapshot: p.name,
      attribute1: p.sizeLabel ?? null,
      attribute2: p.colorPrimary ?? null,
      attribute3: p.colorSecondary ?? null,
      attribute4: null,
      color1: p.colorPrimary ?? null,
      color2: p.colorSecondary ?? null,
    };
  });

  const subtotal = pricing.subtotal;
  const savings = pricing.savings;
  const shippingPrice =
    input.shippingMethod === "KURIR"
      ? deliveryQuote.prices.kurir
      : deliveryQuote.prices.kamion;
  const voucherDiscount = pricing.voucherDiscount;
  const voucherCode = pricing.voucherCode;
  const total = Math.max(
    0,
    subtotal + shippingPrice + assemblyTotal - pricing.totalOrderDiscount,
  );

  const ship = input.shipping;
  const bill = input.billingSameAsShipping ? null : input.billing ?? null;
  const glsProviderActive = getSmallParcelProvider() === "MYGLS";
  const glsDeliveryPoint =
    input.shippingMethod === "KURIR" && glsProviderActive && input.glsDeliveryPoint?.code
      ? await db.courierDeliveryPoint.findFirst({
          where: {
            provider: MYGLS_PROVIDER,
            active: true,
            code: input.glsDeliveryPoint.code,
          },
          select: {
            code: true,
            name: true,
            street: true,
            city: true,
            postalCode: true,
          },
        })
      : null;
  if (
    input.shippingMethod === "KURIR" &&
    glsProviderActive &&
    input.glsDeliveryPoint?.code &&
    !glsDeliveryPoint
  ) {
    return { ok: false, error: { code: "DELIVERY_POINT_INVALID" } };
  }

  const accessToken = createOrderAccessToken();
  const expiresAt = paymentExpiresAt(input.paymentMethod);

  let created: { id: string; number: string; total: Prisma.Decimal };
  try {
    created = await db.$transaction(async (tx) => {
      const number = await nextOrderNumber(tx);

      for (const line of input.lines) {
        const p = bySku.get(line.sku)!;
        const updated = await tx.product.updateMany({
          where: { id: p.id, isActive: true, stock: { gte: line.qty } },
          data: { stock: { decrement: line.qty } },
        });
        if (updated.count !== 1) {
          throw new StockReservationError(line.sku);
        }
      }

      const order = await tx.order.create({
        data: {
          number,
          publicAccessTokenHash: hashOrderAccessToken(accessToken),
          publicAccessTokenCreatedAt: new Date(),
          userId,
          guestEmail: userId ? null : input.guestEmail ?? null,
          subtotal: new Prisma.Decimal(subtotal),
          savings: new Prisma.Decimal(savings),
          shipping: new Prisma.Decimal(shippingPrice),
          assemblyTotal: new Prisma.Decimal(assemblyTotal),
          voucherCode,
          voucherDiscount: voucherDiscount ? new Prisma.Decimal(voucherDiscount) : null,
          firstPurchaseDiscount: pricing.firstPurchaseDiscount
            ? new Prisma.Decimal(pricing.firstPurchaseDiscount)
            : null,
          savedCardDiscount: pricing.savedCardDiscount
            ? new Prisma.Decimal(pricing.savedCardDiscount)
            : null,
          total: new Prisma.Decimal(total),
          shippingMethod: input.shippingMethod,
          paymentMethod: input.paymentMethod,
          shipFirstName: ship.firstName,
          shipLastName: ship.lastName,
          shipPhone: ship.phone,
          shipStreet: ship.street,
          shipCity: ship.city,
          shipPostalCode: ship.postalCode,
          shipCountry: ship.country,
          shipCompanyName: ship.companyName ?? null,
          shipPib: ship.pib ?? null,
          glsDeliveryPointId: glsDeliveryPoint?.code ?? null,
          glsDeliveryPointName: glsDeliveryPoint?.name ?? null,
          glsDeliveryPointAddress: glsDeliveryPoint?.street ?? null,
          glsDeliveryPointCity: glsDeliveryPoint?.city ?? null,
          glsDeliveryPointPostalCode: glsDeliveryPoint?.postalCode ?? null,
          billingSameAsShipping: input.billingSameAsShipping,
          billFirstName: bill?.firstName ?? null,
          billLastName: bill?.lastName ?? null,
          billStreet: bill?.street ?? null,
          billCity: bill?.city ?? null,
          billPostalCode: bill?.postalCode ?? null,
          billCompanyName: bill?.companyName ?? null,
          billPib: bill?.pib ?? null,
          notes: input.notes ?? null,
          termsAcceptedAt: new Date(),
          expiresAt,
          items: { createMany: { data: itemsForCreate } },
          events: { create: { status: "KREIRANO", note: "Porudžbina kreirana" } },
          payments: {
            create: {
              method: input.paymentMethod,
              provider: providerForPaymentMethod(input.paymentMethod),
              amount: new Prisma.Decimal(total),
              status: "PENDING",
              expiresAt,
            },
          },
        },
        select: { id: true, number: true, total: true },
      });

      if (voucherCode) {
        await tx.voucherRedemption.create({
          data: {
            voucherCode,
            userId,
            orderId: order.id,
            amount: new Prisma.Decimal(voucherDiscount),
          },
        });
      }

      if (input.checkoutSessionId) {
        await tx.checkoutSession.upsert({
          where: { id: input.checkoutSessionId },
          create: {
            id: input.checkoutSessionId,
            userId,
            guestEmail: userId ? null : input.guestEmail ?? null,
            identity: userId ? "login" : "guest",
            step: "review",
            status: "CONVERTED",
            lineCount: input.lines.length,
            itemQty: input.lines.reduce((sum, line) => sum + line.qty, 0),
            cartTotal: new Prisma.Decimal(total),
            shippingCity: input.shipping.city,
            shippingMethod: input.shippingMethod,
            paymentMethod: input.paymentMethod,
            orderId: order.id,
          },
          update: {
            userId,
            guestEmail: userId ? null : input.guestEmail ?? null,
            identity: userId ? "login" : "guest",
            step: "review",
            status: "CONVERTED",
            lineCount: input.lines.length,
            itemQty: input.lines.reduce((sum, line) => sum + line.qty, 0),
            cartTotal: new Prisma.Decimal(total),
            shippingCity: input.shipping.city,
            shippingMethod: input.shippingMethod,
            paymentMethod: input.paymentMethod,
            orderId: order.id,
          },
        });
      }

      return order;
    });
  } catch (err) {
    if (err instanceof StockReservationError) {
      return { ok: false, error: { code: "OUT_OF_STOCK", sku: err.sku } };
    }
    throw err;
  }

  if (userId) await clearServerCart(userId).catch(() => undefined);

  // Phase 4A: notify each supplier that owns one of the ordered SKUs so
  // they can hold the units against their warehouse stock. Fire-and-
  // forget — checkout has already committed and supplier divergences are
  // reconciled by the next feed snapshot.
  void notifySuppliersOfReservation({
    orderNumber: created.number,
    lines: input.lines.map((line) => ({
      productId: bySku.get(line.sku)!.id,
      qty: line.qty,
    })),
  });

  // Buyer receipt/proforma: create the durable Invoice row, upload/regenerate
  // the PDF as available, and send the tracked customer confirmation.
  void (async () => {
    try {
      await issueBuyerReceiptForOrder(created.id);
    } catch (err) {
      console.error("[receipt] buyer receipt failed", err);
    }
  })();

  return {
    ok: true,
    data: {
      id: created.id,
      number: created.number,
      accessToken,
      total: num(created.total),
      paymentMethod: input.paymentMethod,
      shippingMethod: input.shippingMethod,
    },
  };
}
