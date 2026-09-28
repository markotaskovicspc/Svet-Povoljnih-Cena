import { readPackedItems } from "./parcel-contents";

/** Units in this physical box, never the order-line or shipment total. */
export function boxQuantity(pkg: { packedQuantity?: number; packedItems?: unknown }) {
  const items = readPackedItems(pkg.packedItems);
  const quantity = items.length
    ? items.reduce((sum, item) => sum + item.quantity, 0)
    : pkg.packedQuantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Broj komada u kutiji nije ispravan. Proverite picking nalog.");
  }
  return quantity;
}

export type LabelBoxQuantity = {
  quantity: number;
  parcelNumber?: string | null;
  clientReference?: string | null;
};

export function myGlsBoxQuantities(raw: unknown): LabelBoxQuantity[] {
  if (!raw || typeof raw !== "object" || !("myGlsPackageAssignments" in raw) ||
      !Array.isArray(raw.myGlsPackageAssignments)) return [];
  return raw.myGlsPackageAssignments.flatMap((entry) =>
    entry && Number.isSafeInteger(entry.packedQuantity) && entry.packedQuantity > 0
      ? [{ quantity: entry.packedQuantity, parcelNumber: String(entry.parcelNumber), clientReference: entry.clientReference }]
      : [],
  );
}
