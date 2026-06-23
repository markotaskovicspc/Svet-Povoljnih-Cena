import "server-only";

import type { Order, Reclamation } from "@/types";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";

/**
 * Phase 4D — adapt Prisma rows into the canonical `@/types` Order /
 * Reclamation shapes the email templates expect. Every send-site that
 * starts from an `orderId` / `reclamationId` should funnel through here so
 * the template props stay decoupled from the database layout.
 */

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
const RECLAMATION_STATUS_LOWER = {
  PRIMLJENO: "primljeno",
  U_OBRADI: "u_obradi",
  RESENO: "reseno",
  ODBIJENO: "odbijeno",
} as const;

export type PrismaOrderStatus = keyof typeof ORDER_STATUS_LOWER;
export type PrismaReclamationStatus = keyof typeof RECLAMATION_STATUS_LOWER;

export function lowerOrderStatus(s: PrismaOrderStatus): Order["status"] {
  return ORDER_STATUS_LOWER[s];
}

export function lowerReclamationStatus(
  s: PrismaReclamationStatus,
): Reclamation["status"] {
  return RECLAMATION_STATUS_LOWER[s];
}

export async function loadOrderForEmail(
  orderId: string,
): Promise<{ order: Order; recipient: string | null } | null> {
  const row = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: { id: "asc" } },
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
      user: { select: { email: true, phone: true } },
    },
  });
  if (!row) return null;

  const order: Order = {
    id: row.number,
    userId: row.userId ?? undefined,
    guestEmail: row.guestEmail ?? undefined,
    customerEmail: row.user?.email ?? row.guestEmail ?? undefined,
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

  const recipient = row.user?.email ?? row.guestEmail ?? null;
  return { order, recipient };
}

export async function loadReclamationForEmail(
  reclamationId: string,
): Promise<{ reclamation: Reclamation; recipient: string | null } | null> {
  const row = await db.reclamation.findUnique({
    where: { id: reclamationId },
    include: { photos: true, order: { select: { number: true } } },
  });
  if (!row) return null;

  const reclamation: Reclamation = {
    id: row.number,
    orderId: row.order.number,
    sku: row.sku,
    customer: {
      firstName: row.customerFirst,
      lastName: row.customerLast,
      email: row.customerEmail ?? undefined,
      phone: row.customerPhone ?? undefined,
    },
    description: row.description,
    photos: row.photos.map((p) => ({
      url: p.url,
      width: p.width ?? undefined,
      height: p.height ?? undefined,
    })),
    notifyVia: row.notifyVia === "PHONE" ? "phone" : "email",
    status: RECLAMATION_STATUS_LOWER[row.status],
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString(),
  };

  const recipient =
    row.notifyVia === "EMAIL" ? row.customerEmail ?? null : null;
  return { reclamation, recipient };
}
