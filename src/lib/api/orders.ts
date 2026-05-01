import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";

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
