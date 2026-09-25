import { buildPickupPrintRows, type PickupPrintLine } from "./pickup-print";

// Exact cell order from Magacin picking pozicije.pdf. Walking order is separate.
export const pickingLayout = [
  [29, -2, 240, -2], [30, -2, 239, -2],
  [31, 2, 182, 2], [32, 2, 181, 2],
  [89, -2, 180, -2], [90, -2, 179, -2],
  [91, 2, 122, 2], [92, 2, 121, 2],
].map(([left, dl, right, dr]) => [
  Array.from({ length: 15 }, (_, i) => left + dl * i),
  Array.from({ length: 15 }, (_, i) => right + dr * i),
]);

export type PositionedLine = PickupPrintLine & {
  warehouseId: string; warehouseName: string; orderId: string; orderNumber: string; supplierId: string | null;
};
export type PickingPosition = { warehouseId: string; number: number; routeOrder: number; skus: string[]; supplierIds: string[] };
export type PickingRow = {
  key: string; sku: string; name: string; barcode: string | null; quantity: number;
  warehouseName: string; positions: number[]; routeOrder: number;
  allocations: { orderId: string; orderNumber: string; quantity: number }[];
};
export function buildPickingPlan(lines: PositionedLine[], positions: PickingPosition[]): PickingRow[] {
  const groups = new Map<string, PositionedLine[]>();
  for (const line of lines) {
    if (line.deferredAt || line.purpose === "RECLAMATION_RETURN") continue;
    const key = JSON.stringify([line.warehouseId, line.orderId]);
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const result = new Map<string, PickingRow>();
  for (const group of groups.values()) {
    const first = group[0];
    for (const row of buildPickupPrintRows(group)) {
      const key = JSON.stringify([first.warehouseId, row.key]);
      const supplierId = group.find(line => line.orderItem?.sku === row.sku)?.supplierId;
      const assigned = positions.filter(p => p.warehouseId === first.warehouseId && p.skus.includes(row.sku));
      const locations = (assigned.length ? assigned : positions.filter(p => p.warehouseId === first.warehouseId && !!supplierId && p.supplierIds.includes(supplierId)))
        .sort((a, b) => a.routeOrder - b.routeOrder || a.number - b.number);
      const current = result.get(key) ?? {
        key, sku: row.sku, name: row.name, barcode: row.barcode, quantity: 0,
        warehouseName: first.warehouseName, positions: locations.map(p => p.number),
        routeOrder: locations[0]?.routeOrder ?? 10001, allocations: [],
      };
      current.quantity += row.quantity;
      current.allocations.push({ orderId: first.orderId, orderNumber: first.orderNumber, quantity: row.quantity });
      result.set(key, current);
    }
  }
  return [...result.values()].sort((a, b) => a.warehouseName.localeCompare(b.warehouseName) || a.routeOrder - b.routeOrder || a.sku.localeCompare(b.sku));
}
export function validatePickingDelta(current: number, delta: number, required: number) {
  if (!Number.isSafeInteger(delta) || current + delta < 0 || current + delta > required) {
    throw new Error(`Količina mora biti između 0 i ${required}. Osvežite pregled ako još neko odvaja robu.`);
  }
  return current + delta;
}
