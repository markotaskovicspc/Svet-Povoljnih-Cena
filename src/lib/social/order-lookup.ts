import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";

// Customer order check from the chat (client request 13.11.2026): the customer
// gives the SPC order number or the first and last name used when ordering.
// Only number, date, status and item names are returned — never address,
// phone, email or payment data.
export const socialOrderLookupRequest = z.object({
  action: z.literal("order_lookup"),
  number: z.string().trim().max(80).nullable().default(null),
  fullName: z.string().trim().max(150).nullable().default(null),
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
  if (body.number && !body.fullName) return { ok: false as const, error: "INVALID_ORDER_NUMBER" };
  const tokens = fold(body.fullName ?? "").split(" ").filter((token) => token.length > 1);
  if (tokens.length < 2) return { ok: false as const, error: "FULL_NAME_REQUIRED" };
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
    .slice(0, 3)
    .map(view);
  return { ok: true as const, orders };
}
