import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";

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
} as const;

type Row = { number: string; createdAt: Date; status: string; items: { name: string; qty: number }[] };
const view = (order: Row) => ({
  number: order.number,
  createdAt: order.createdAt.toISOString().slice(0, 10),
  status: order.status,
  items: order.items.map((item) => ({ name: item.name, qty: item.qty })),
});

export async function socialOrderLookup(body: z.infer<typeof socialOrderLookupRequest>) {
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
    return { ok: true as const, matchedBy: "shipment" as const, orders: orders.map(view) };
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
  const orders = candidates
    .filter((order) => sameName(name, order.shipFirstName, order.shipLastName) || sameName(name, order.billFirstName, order.billLastName))
    .filter((order) => samePhone(body.phone, order.shipPhone) || sameAddress(body.address, order.shipStreet, order.shipCity))
    .slice(0, 3)
    .map(view);
  return { ok: true as const, orders };
}
