import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AnanasClient } from "./client";
import { ananasDateRange } from "./documents";
import { ananasError } from "./sync";
import { ananasOrderStatus, normalizeAnanasOrder, normalizeAnanasShipments } from "./orders";

export async function syncAnanasOrders(from: Date, to: Date, source: "ORDERS_MANUAL" | "ORDERS_AUTO" = "ORDERS_MANUAL") {
  ananasDateRange(from.toISOString(), to.toISOString());
  const run = await db.$transaction(async tx => {
    // Serializes only the short lease acquisition, not external API requests.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ananas-orders-sync'))::text`;
    const running = await tx.ananasSyncRun.findFirst({ where: { source: { in: ["ORDERS_AUTO", "ORDERS_MANUAL"] }, status: "RUNNING", startedAt: { gt: new Date(Date.now() - 300000) } } });
    if (running) throw new Error("Ananas uvoz porudžbina je već u toku. Sačekajte završetak.");
    return tx.ananasSyncRun.create({ data: { from, to, source, status: "RUNNING" } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  const api = new AnanasClient(fetch, AbortSignal.timeout(180000));
  try {
    const incoming = (await api.orders(new URLSearchParams({ dateFrom: from.toISOString(), dateTo: new Date(to.getTime() - 1).toISOString() }))).map(normalizeAnanasOrder);
    const orders = [...new Map(incoming.map(row => [row.id, row])).values()];
    const batchShipments = [];
    for (const statusGroup of ["SG_FOR_PACKAGING", "SG_SHIPMENT_ON_DELIVERY", "SG_COMPLETED"]) {
      batchShipments.push(...normalizeAnanasShipments(await api.shipments(new URLSearchParams({ statusGroup,
        confirmedFrom: from.toISOString(), confirmedTo: new Date(to.getTime() - 1).toISOString(),
      }))));
    }
    const uniqueShipments = [...new Map(batchShipments.map(s => [s.suborderId, s])).values()];
    // Save the immutable identity of each remote order; never call local Order/stock/fiscal services.
    for (let offset = 0; offset < orders.length; offset += 100) {
      await db.$transaction(orders.slice(offset, offset + 100).map(data => {
        const shipments = uniqueShipments.filter(s => s.orderId === data.id);
        const status = shipments.length ? { shipments, ...ananasOrderStatus(shipments, data.items.reduce((n, i) => n + i.quantity, 0)), lastCheckedAt: new Date() } : {};
        return db.ananasOrder.upsert({ where: { id: data.id }, create: { ...data, shipments: [], ...status }, update: { ...data, ...status } });
      }));
    }
    // Bounded round-robin also checks old open orders outside the creation-date window.
    // A new order has epoch lastCheckedAt, so all new imports eventually receive a status.
    const open = await db.ananasOrder.findMany({ where: { OR: [
      { needsRefresh: true, lastCheckedAt: { lt: new Date(Date.now() - 10 * 60000) } },
      { lastCheckedAt: { lt: new Date(Date.now() - 7 * 86400000) } },
    ] }, orderBy: [{ lastCheckedAt: "asc" }, { id: "asc" }], take: 40 });
    for (const order of open) {
      const refreshed = (await api.orders(new URLSearchParams({ orderId: order.id }))).map(normalizeAnanasOrder);
      if (refreshed.some(o => o.id !== order.id)) throw new Error("Ananas odgovor ne odgovara traženoj porudžbini.");
      const raw = await api.shipments(new URLSearchParams({ search: order.id }));
      const shipments = normalizeAnanasShipments(raw);
      if (shipments.some(s => s.orderId !== order.id)) throw new Error("Ananas pošiljka ne odgovara traženoj porudžbini.");
      const items = refreshed[0]?.items ?? order.items as { quantity: number }[];
      const status = ananasOrderStatus(shipments, items.reduce((sum, item) => sum + item.quantity, 0));
      await db.ananasOrder.update({ where: { id: order.id }, data: { ...refreshed[0], shipments, ...status, lastCheckedAt: new Date() } });
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await db.ananasSyncRun.update({ where: { id: run.id }, data: { status: "SUCCESS", count: orders.length, finishedAt: new Date() } });
    return { count: orders.length, checked: open.length, runId: run.id };
  } catch (error) {
    const message = `Ananas uvoz porudžbina: ${ananasError(error)}`;
    await db.ananasSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", error: message, finishedAt: new Date() } });
    throw new Error(message);
  }
}
export async function syncAnanasOrdersAutomatically(now = new Date()) {
  const last = await db.ananasSyncRun.findFirst({ where: { source: "ORDERS_AUTO", status: "SUCCESS" }, orderBy: { to: "desc" } });
  const from = new Date(last ? last.to.getTime() - 86400000 : now.getTime() - 30 * 86400000);
  return syncAnanasOrders(from, new Date(Math.min(now.getTime(), from.getTime() + 31 * 86400000)), "ORDERS_AUTO");
}
