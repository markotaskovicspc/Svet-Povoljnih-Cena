import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import type { Order } from "@/types";

/**
 * Order history reads for `/nalog/porudzbine`.
 * Detail returns the full timeline and items; list returns a slim row.
 */

const orderListSelect = {
  id: true,
  number: true,
  status: true,
  total: true,
  createdAt: true,
  items: { select: { sku: true, name: true, qty: true, thumbnailUrl: true }, take: 4 },
} satisfies Prisma.OrderSelect;

export async function listOrders(userId: string) {
  const rows = await db.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: orderListSelect,
  });
  return rows.map((o) => ({ ...o, total: num(o.total) }));
}

export async function getOrderForUser(userId: string, numberOrId: string) {
  const order = await db.order.findFirst({
    where: { userId, OR: [{ id: numberOrId }, { number: numberOrId }] },
    include: {
      items: true,
      events: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { createdAt: "asc" } },
      shipments: { include: { events: { orderBy: { occurredAt: "asc" } } } },
      invoices: true,
      fiscal: true,
    },
  });
  if (!order) return null;
  return {
    ...order,
    subtotal: num(order.subtotal),
    savings: num(order.savings),
    shipping: num(order.shipping),
    assemblyTotal: num(order.assemblyTotal),
    voucherDiscount: order.voucherDiscount ? num(order.voucherDiscount) : null,
    total: num(order.total),
    items: order.items.map((i) => ({
      ...i,
      unitPriceFull: num(i.unitPriceFull),
      unitPriceSale: num(i.unitPriceSale),
      assemblyPrice: i.assemblyPrice ? num(i.assemblyPrice) : null,
    })),
    payments: order.payments.map((p) => ({ ...p, amount: num(p.amount) })),
  };
}

const PAYMENT_METHOD_LOWER = {
  IPS: "ips",
  KARTICA: "kartica",
  GOOGLE_PAY: "google_pay",
  APPLE_PAY: "apple_pay",
  UPLATA_NA_RACUN: "uplata_na_racun",
  POUZECE_GOTOVINA: "pouzece_gotovina",
  POUZECE_KARTICA: "pouzece_kartica",
} as const;
const SHIPPING_METHOD_LOWER = { KURIR: "kurir", KAMION: "kamion" } as const;
const ORDER_STATUS_LOWER = {
  KREIRANO: "kreirano",
  POTVRDJENO: "potvrdjeno",
  U_PRIPREMI: "u_pripremi",
  SPREMNO_ZA_ISPORUKU: "spremno_za_isporuku",
  U_ISPORUCI: "u_isporuci",
  ISPORUCENO: "isporuceno",
  OTKAZANO: "otkazano",
  VRACENO: "vraceno",
} as const;
const PAYMENT_STATUS_LOWER = {
  PENDING: "pending",
  AUTHORIZED: "authorized",
  PAID: "paid",
  FAILED: "failed",
  REFUNDED: "refunded",
  PARTIAL_REFUND: "partial_refund",
} as const;

export async function getPublicOrderForConfirmation(numberOrId: string): Promise<Order | null> {
  const row = await db.order.findFirst({
    where: { OR: [{ id: numberOrId }, { number: numberOrId }] },
    include: {
      items: { orderBy: { id: "asc" } },
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!row) return null;

  return {
    id: row.number,
    userId: row.userId ?? undefined,
    guestEmail: row.guestEmail ?? undefined,
    status: ORDER_STATUS_LOWER[row.status],
    items: row.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      qty: i.qty,
      unitPriceFull: num(i.unitPriceFull),
      unitPriceSale: num(i.unitPriceSale),
      withAssembly: i.withAssembly,
      assemblyPrice: i.assemblyPrice ? num(i.assemblyPrice) : undefined,
      thumbnailUrl: i.thumbnailUrl ?? undefined,
    })),
    subtotal: num(row.subtotal),
    savings: num(row.savings),
    shipping: num(row.shipping),
    assemblyTotal: num(row.assemblyTotal),
    voucherCode: row.voucherCode ?? undefined,
    voucherDiscount: row.voucherDiscount ? num(row.voucherDiscount) : undefined,
    total: num(row.total),
    shippingMethod: SHIPPING_METHOD_LOWER[row.shippingMethod],
    paymentMethod: PAYMENT_METHOD_LOWER[row.paymentMethod],
    shippingAddress: {
      id: `${row.id}-ship`,
      firstName: row.shipFirstName,
      lastName: row.shipLastName,
      phone: row.shipPhone,
      street: row.shipStreet,
      city: row.shipCity,
      postalCode: row.shipPostalCode,
      country: row.shipCountry,
      companyName: row.shipCompanyName ?? undefined,
      pib: row.shipPib ?? undefined,
    },
    billingAddress: row.billingSameAsShipping
      ? undefined
      : row.billFirstName
        ? {
            id: `${row.id}-bill`,
            firstName: row.billFirstName,
            lastName: row.billLastName ?? "",
            phone: row.shipPhone,
            street: row.billStreet ?? "",
            city: row.billCity ?? "",
            postalCode: row.billPostalCode ?? "",
            country: row.shipCountry,
            companyName: row.billCompanyName ?? undefined,
            pib: row.billPib ?? undefined,
          }
        : undefined,
    notes: row.notes ?? undefined,
    payment: row.payments[0]
      ? {
          status: PAYMENT_STATUS_LOWER[row.payments[0].status],
          providerRef: row.payments[0].providerRef ?? undefined,
          paymentReference: row.payments[0].paymentReference ?? undefined,
          paidAt: row.payments[0].paidAt?.toISOString(),
        }
      : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
