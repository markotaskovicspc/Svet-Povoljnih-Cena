import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { signSocialQuote } from "./security";

// Customer order check from the chat (client request 13.11.2026): the customer
// gives the SPC order number, another number (courier tracking/parcel number,
// resolved through Shipment), or the first and last name used when ordering
// together with the delivery address or phone. Only number, date, status and
// item names are returned — never address, phone, email or payment data.
export const socialOrderLookupRequest = z.object({
  action: z.literal("order_lookup"),
  number: z.string().trim().max(80).nullable().default(null),
  fullName: z.string().trim().max(150).nullable().default(null),
  phone: z.string().trim().max(40).nullable().default(null),
  address: z.string().trim().max(200).nullable().default(null),
  // Chat identity: a name match with phone/address proves ownership like the
  // e-mail code does, so a reclamation can be opened in this same chat.
  channel: z.enum(["facebook", "instagram", "web"]).optional(),
  conversationId: z.string().min(3).max(200).optional(),
});

const fold = (value: string) =>
  value
    .toLowerCase()
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function looseOrderNumber(raw: string | null | undefined) {
  const match = String(raw ?? "")
    .toUpperCase()
    .match(/SPC[\s._/-]*(20\d{2})[\s._/-]*(\d{1,6})(?!\d)/);
  return match ? `SPC-${match[1]}-${match[2].padStart(6, "0")}` : null;
}

export function sameName(input: string, first: string | null | undefined, last: string | null | undefined) {
  const wanted = fold(input).split(" ").filter(Boolean).sort().join(" ");
  const actual = fold(`${first ?? ""} ${last ?? ""}`).split(" ").filter(Boolean).sort().join(" ");
  return wanted.length > 0 && wanted === actual;
}

const digits = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "").replace(/^381/, "0").replace(/^0+/, "");

export function samePhone(input: string | null | undefined, phone: string | null | undefined) {
  const a = digits(input), b = digits(phone);
  return a.length >= 8 && b.length >= 8 && a.slice(-8) === b.slice(-8);
}

export function sameAddress(input: string | null | undefined, street: string | null | undefined, city: string | null | undefined) {
  const wanted = fold(input ?? "");
  const streetName = fold(street ?? "").replace(/\b\d+[a-z]?\b/g, "").trim();
  if (streetName.length < 3 || !wanted.includes(streetName)) return false;
  const town = fold(city ?? "").split(" ")[0] ?? "";
  // A street alone is common to many towns; accept it when the town or house number also matches.
  return (town.length > 1 && wanted.includes(town)) || /\d/.test(wanted);
}

// ILIKE pattern that tolerates missing Serbian diacritics (c/č/ć, s/š, z/ž, dj/đ).
const likePattern = (token: string) =>
  `%${token.replace(/[\\%_]/g, "").replace(/dj/g, "%").replace(/[cszd]/g, "_")}%`;

const select = {
  id: true,
  number: true,
  channel: true,
  createdAt: true,
  status: true,
  shipFirstName: true,
  shipLastName: true,
  shipPhone: true,
  shipStreet: true,
  shipCity: true,
  billFirstName: true,
  billLastName: true,
  items: { select: { name: true, qty: true } },
  shipments: {
    where: { purpose: "ORDER_DELIVERY" as const },
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: {
      provider: true, trackingNo: true, status: true, shippedAt: true, deliveredAt: true,
      events: { orderBy: { occurredAt: "desc" as const }, take: 1, select: { status: true, message: true, occurredAt: true } },
    },
  },
} as const;

// Standard delivery term: 3 working days from the order (Uslovi isporuke).
export const DELIVERY_WORKING_DAYS = 3;
export function addWorkingDays(from: Date, days: number) {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let left = days;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return date;
}
const courierName = (provider: string | null | undefined) => {
  const p = String(provider ?? "").toUpperCase();
  return p.includes("GLS") ? "GLS" : p.includes("X") ? "X Express" : null;
};
type ShipmentRow = { provider: string | null; trackingNo: string | null; status: string; shippedAt: Date | null; deliveredAt: Date | null;
  events?: { status: string; message: string | null; occurredAt: Date }[] };
type Row = { number: string; createdAt: Date; status: string; items: { name: string; qty: number }[]; shipments?: ShipmentRow[] };
const CLOSED = new Set(["ISPORUCENO", "OTKAZANO", "VRACENO"]);
// Status, courier and the latest courier event, so the chatbot answers "where
// is my parcel" itself and hands off only when the order is really late.
export const view = (order: Row, now = new Date()) => {
  const shipment = order.shipments?.[0] ?? null;
  const event = shipment?.events?.[0] ?? null;
  const expectedBy = addWorkingDays(order.createdAt, DELIVERY_WORKING_DAYS);
  const deliveryProblem = shipment ? ["FAILED", "RETURNED"].includes(shipment.status) : false;
  const late = !CLOSED.has(order.status) && (deliveryProblem || now.getTime() > expectedBy.getTime() + 86400000);
  return {
    number: order.number,
    createdAt: order.createdAt.toISOString().slice(0, 10),
    status: order.status,
    items: order.items.map((item) => ({ name: item.name, qty: item.qty })),
    expectedBy: expectedBy.toISOString().slice(0, 10),
    late,
    shipment: shipment ? {
      courier: courierName(shipment.provider),
      trackingNo: shipment.trackingNo,
      status: shipment.status,
      shippedAt: shipment.shippedAt?.toISOString().slice(0, 10) ?? null,
      deliveredAt: shipment.deliveredAt?.toISOString().slice(0, 10) ?? null,
      lastEvent: event ? { status: event.status, message: event.message?.slice(0, 200) ?? null, at: event.occurredAt.toISOString().slice(0, 16) } : null,
    } : null,
  };
};
export const orderViewSelect = select;

export async function socialOrderLookup(body: z.infer<typeof socialOrderLookupRequest>, secret?: string) {
  const number = looseOrderNumber(body.number);
  if (number) {
    const order = await db.order.findUnique({ where: { number }, select });
    if (!order || order.channel === "ANANAS") return { ok: true as const, orders: [] };
    return { ok: true as const, orders: [view(order)] };
  }
  const other = String(body.number ?? "").replace(/[\s-]/g, "");
  if (/^[A-Za-z0-9]{5,40}$/.test(other)) {
    const shipments = await db.$queryRaw<{ orderId: string }[]>`
      SELECT "orderId" FROM "Shipment"
      WHERE "trackingNo" = ${other} OR "providerOrderId" = ${other} OR "providerParcelId" = ${other}
        OR "providerParcelNumbers"::text LIKE ${`%${other}%`}
      LIMIT 5`;
    const orders = shipments.length
      ? await db.order.findMany({ where: { id: { in: shipments.map((row) => row.orderId) }, channel: { not: "ANANAS" } }, orderBy: { createdAt: "desc" }, take: 3, select })
      : [];
    return { ok: true as const, matchedBy: "shipment" as const, orders: orders.map((o) => view(o)) };
  }
  if (body.number && !body.fullName) return { ok: false as const, error: "INVALID_ORDER_NUMBER" };
  const tokens = fold(body.fullName ?? "").split(" ").filter((token) => token.length > 1);
  if (tokens.length < 2) return { ok: false as const, error: "FULL_NAME_REQUIRED" };
  if (!body.phone && !body.address) return { ok: false as const, error: "ADDRESS_OR_PHONE_REQUIRED" };
  const patterns = [...new Set(tokens.map(likePattern))];
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const ids = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Order"
    WHERE "createdAt" >= ${since} AND channel <> 'ANANAS'
      AND ("shipLastName" ILIKE ANY(${patterns}) OR "billLastName" ILIKE ANY(${patterns}))
    ORDER BY "createdAt" DESC LIMIT 200`;
  if (!ids.length) return { ok: true as const, orders: [] };
  const candidates = await db.order.findMany({
    where: { id: { in: ids.map((row) => row.id) } },
    orderBy: { createdAt: "desc" },
    select,
  });
  const name = tokens.join(" ");
  const matched = candidates
    .filter((order) => sameName(name, order.shipFirstName, order.shipLastName) || sameName(name, order.billFirstName, order.billLastName))
    .filter((order) => samePhone(body.phone, order.shipPhone) || sameAddress(body.address, order.shipStreet, order.shipCity))
    .slice(0, 3);
  const orders = matched.map((o) => view(o));
  // Same proof as reclamation_verify_finish (2 h, bound to this chat). Only for
  // name + phone/address matches, never for a bare order or parcel number.
  if (secret && secret.length >= 32 && body.channel && body.conversationId && matched.length) {
    const expiresAt = Date.now() + 2 * 3600000;
    const claimProofs = Object.fromEntries(matched.map((order) => [order.number, signSocialQuote({
      channel: body.channel, conversationId: body.conversationId, purpose: "reclamation_owner", orderId: order.id, number: order.number, expiresAt,
    }, secret)]));
    return { ok: true as const, orders, claimProofs };
  }
  return { ok: true as const, orders };
}
