import {
  EXCLUDE_SALE_FROM_STACK,
  FIRST_PURCHASE_PCT,
  MAX_STACK_PCT,
  SAVED_CARD_PCT,
} from "@/lib/pricing/config";
import { capDiscountComponents } from "@/lib/pricing/engine";

export type WebOrderEditLine = {
  qty: number;
  unitPriceFull: number;
  unitPriceSale: number;
  assemblyPrice?: number | null;
};

export type WebOrderEditTotals = {
  subtotal: number;
  savings: number;
  shipping: number;
  assemblyTotal: number;
  voucherDiscount: number;
  firstPurchaseDiscount: number;
  savedCardDiscount: number;
  totalOrderDiscount: number;
  total: number;
};

function money(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Reprices an existing WEB order from its immutable line-price snapshots.
 * Only quantities change: an admin edit must never pick up a newer catalog
 * price than the customer originally accepted.
 */
export function calculateEditedWebOrderTotals(input: {
  lines: WebOrderEditLine[];
  shipping: number;
  requestedVoucherDiscount?: number;
  keepFirstPurchaseDiscount?: boolean;
  keepSavedCardDiscount?: boolean;
}): WebOrderEditTotals {
  const subtotal = money(
    input.lines.reduce(
      (sum, line) => sum + line.unitPriceSale * line.qty,
      0,
    ),
  );
  const savings = money(
    input.lines.reduce(
      (sum, line) =>
        sum + Math.max(0, line.unitPriceFull - line.unitPriceSale) * line.qty,
      0,
    ),
  );
  const assemblyTotal = money(
    input.lines.reduce(
      (sum, line) => sum + Math.max(0, line.assemblyPrice ?? 0) * line.qty,
      0,
    ),
  );
  const eligibleForStack = EXCLUDE_SALE_FROM_STACK
    ? money(
        input.lines
          .filter((line) => line.unitPriceSale >= line.unitPriceFull)
          .reduce((sum, line) => sum + line.unitPriceSale * line.qty, 0),
      )
    : subtotal;
  const requested = {
    voucher: Math.max(0, input.requestedVoucherDiscount ?? 0),
    first: input.keepFirstPurchaseDiscount
      ? Math.round((eligibleForStack * FIRST_PURCHASE_PCT) / 100)
      : 0,
    card: input.keepSavedCardDiscount
      ? Math.round((eligibleForStack * SAVED_CARD_PCT) / 100)
      : 0,
  };
  const maxAllowed = Math.round((eligibleForStack * MAX_STACK_PCT) / 100);
  const applied = capDiscountComponents(requested, maxAllowed);
  const totalOrderDiscount = money(
    Math.min(applied.voucher + applied.first + applied.card, eligibleForStack),
  );
  const shipping = money(Math.max(0, input.shipping));

  return {
    subtotal,
    savings,
    shipping,
    assemblyTotal,
    voucherDiscount: money(applied.voucher),
    firstPurchaseDiscount: money(applied.first),
    savedCardDiscount: money(applied.card),
    totalOrderDiscount,
    total: money(
      Math.max(0, subtotal + shipping + assemblyTotal - totalOrderDiscount),
    ),
  };
}

export function planWebOrderQuantityReduction(input: {
  currentQty: number;
  newQty: number;
  warehouseReservedQty: number;
  supplierReservedQty: number;
  legacyWarehouseDebited: boolean;
}) {
  if (!Number.isInteger(input.newQty) || input.newQty < 0) {
    throw new Error("Nova količina mora biti nenegativan ceo broj.");
  }
  if (input.newQty >= input.currentQty) {
    throw new Error("Količina može samo da se smanji.");
  }

  const reductionQty = input.currentQty - input.newQty;
  const supplierReleaseQty = Math.min(
    reductionQty,
    Math.max(0, input.supplierReservedQty),
  );
  const warehouseReleaseQty = reductionQty - supplierReleaseQty;
  const trackedWarehouseQty = Math.max(0, input.warehouseReservedQty);
  const legacyWarehouseQty = input.legacyWarehouseDebited
    ? Math.max(0, input.currentQty - input.supplierReservedQty)
    : 0;
  const warehouseAllocationQty = Math.max(
    trackedWarehouseQty,
    legacyWarehouseQty,
  );

  if (warehouseReleaseQty > warehouseAllocationQty) {
    throw new Error(
      "Rezervacija stavke nije potpuna; izmena je blokirana radi zaštite lagera.",
    );
  }

  return {
    reductionQty,
    supplierReleaseQty,
    warehouseReleaseQty,
    restorePhysicalWarehouseQty: input.legacyWarehouseDebited
      ? warehouseReleaseQty
      : 0,
    nextWarehouseReservedQty: Math.max(
      0,
      trackedWarehouseQty - warehouseReleaseQty,
    ),
    nextSupplierReservedQty: Math.max(
      0,
      input.supplierReservedQty - supplierReleaseQty,
    ),
  };
}
