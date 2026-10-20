export type PickingPosition = {
  warehouseId: string;
  number: number;
  routeOrder: number;
  skus: string[];
  supplierIds: string[];
};

export function resolvePickingPositions(
  positions: PickingPosition[],
  item: { warehouseId: string; sku: string; supplierId?: string | null },
) {
  const warehousePositions = positions.filter(position => position.warehouseId === item.warehouseId);
  const assigned = warehousePositions.filter(position => position.skus.includes(item.sku));
  return (assigned.length ? assigned : warehousePositions.filter(position =>
    Boolean(item.supplierId && position.supplierIds.includes(item.supplierId)),
  )).sort((left, right) => left.routeOrder - right.routeOrder || left.number - right.number);
}
