export type ReturnWarehouseCandidate = {
  code: string;
  name: string;
  active?: boolean;
  isDefault?: boolean;
};

const RETURN_WAREHOUSE_PATTERN = /ostec|ošteć|povrat|return|damage/i;

export function isReturnWarehouse(warehouse: ReturnWarehouseCandidate) {
  return (
    warehouse.active !== false &&
    warehouse.isDefault !== true &&
    RETURN_WAREHOUSE_PATTERN.test(`${warehouse.code} ${warehouse.name}`)
  );
}

export function filterReturnWarehouses<T extends ReturnWarehouseCandidate>(
  warehouses: readonly T[],
) {
  return warehouses.filter(isReturnWarehouse);
}
