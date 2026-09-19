import { expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
vi.mock("@/lib/channel-availability.server", () => ({ syncProductChannelAvailability: async () => undefined }));
import { reconcileWarehouseInventory } from "@/lib/inventory";
import { resolveStoredWarehouseBalance } from "@/lib/reservation-stock";
it.each([
  { label: "new", initial: 10, counted: 10, reservations: [{ qty: 3, debited: false }], expected: 7 },
  { label: "legacy", initial: 7, counted: 10, reservations: [{ qty: 3, debited: true }], expected: 7 },
  { label: "mixed", initial: 8, counted: 10, reservations: [{ qty: 2, debited: true }, { qty: 3, debited: false }], expected: 5 },
  { label: "real shortage", initial: 10, counted: 2, reservations: [{ qty: 3, debited: false }], expected: 0 },
  { label: "count correction", initial: 10, counted: 12, reservations: [{ qty: 3, debited: false }], expected: 9 },
])("preserves physical stock and counts $label reservations once", async ({ initial, counted, reservations, expected }) => {
  let stored = initial;
  let total = initial;
  const tx = {
    $queryRaw: async () => [{ id: "p" }],
    stockMovement: { findUnique: async () => null, create: async ({ data }: { data: unknown }) => data },
    product: { findUnique: async () => ({ sku: "TEST", stock: total }), updateMany: async ({ data }: { data: { stock: { increment: number } } }) => { total += data.stock.increment; return { count: 1 }; } },
    warehouse: { findUnique: async () => ({ id: "dc", active: true, isDefault: true }) },
    warehouseStock: {
      findFirst: async () => ({ id: "ws" }), upsert: async () => ({ qty: stored }),
      update: async ({ data }: { data: { qty: number } }) => { stored = data.qty; return { qty: stored }; },
    },
    orderItem: { findMany: async () => reservations.map(r => ({ warehouseReservedQty: r.qty, stockMovements: r.debited ? [{ qty: -r.qty }] : [] })) },
  } as unknown as Prisma.TransactionClient;
  await reconcileWarehouseInventory(tx, { idempotencyKey: "audit", warehouseId: "dc", productId: "p", countedQty: counted, dispatchNoteId: "popis", note: "Audit" });
  const balance = resolveStoredWarehouseBalance({ storedQty: stored, orderReservations: reservations });
  expect(balance).toMatchObject({ physical: counted, available: expected });
  expect(total).toBe(stored);
});
