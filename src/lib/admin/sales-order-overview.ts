import type { ErpRow } from "@/lib/admin/erp";

const VAT_FACTOR = 1.2;

function cents(value: number) {
  return Math.max(0, Math.round(value * 100));
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type SalesOrderOverviewLine = {
  id: string;
  qty: number;
  unitPrice: number;
};

export type SalesOrderOverviewLineTotals = {
  discount: number;
  totalGross: number;
  totalNet: number;
};

/**
 * Allocates only the persisted first-purchase discount over merchandise lines.
 * Integer cents and largest-remainder allocation keep the displayed line sum
 * exactly equal to the order-level discount. Delivery remains undiscounted.
 */
export function discountedSalesOrderLineTotals(
  lines: readonly SalesOrderOverviewLine[],
  firstPurchaseDiscount: number,
) {
  const prepared = lines.map((line, index) => ({
    ...line,
    index,
    qty: Math.max(0, Math.trunc(line.qty)),
    baseCents: cents(line.unitPrice) * Math.max(0, Math.trunc(line.qty)),
  }));
  const baseTotal = prepared.reduce((sum, line) => sum + line.baseCents, 0);
  const appliedDiscount = Math.min(cents(firstPurchaseDiscount), baseTotal);
  const shares = prepared.map((line) => {
    const exact = baseTotal > 0
      ? (appliedDiscount * line.baseCents) / baseTotal
      : 0;
    const allocated = Math.floor(exact);
    return {
      line,
      allocated,
      remainder: exact - allocated,
    };
  });
  let leftover =
    appliedDiscount - shares.reduce((sum, share) => sum + share.allocated, 0);
  for (const share of [...shares].sort(
    (left, right) =>
      right.remainder - left.remainder || left.line.index - right.line.index,
  )) {
    if (leftover <= 0) break;
    share.allocated += 1;
    leftover -= 1;
  }

  return new Map<string, SalesOrderOverviewLineTotals>(
    shares.map(({ line, allocated }) => {
      const grossCents = Math.max(0, line.baseCents - allocated);
      const totalGross = grossCents / 100;
      return [
        line.id,
        {
          discount: allocated / 100,
          totalGross,
          totalNet: money(totalGross / VAT_FACTOR),
        },
      ];
    }),
  );
}

export type SalesOrderGridSummary = {
  orderCount: number;
  rowCount: number;
  totalNet: number;
  totalGross: number;
};

export function summarizeSalesOrderRows(
  rows: readonly Pick<ErpRow, "id" | "detailId" | "values">[],
): SalesOrderGridSummary {
  const orderIds = new Set(rows.map((row) => row.detailId ?? row.id));
  return {
    orderCount: orderIds.size,
    rowCount: rows.length,
    totalNet: money(
      rows.reduce(
        (sum, row) =>
          sum +
          (typeof row.values.totalNet === "number" ? row.values.totalNet : 0),
        0,
      ),
    ),
    totalGross: money(
      rows.reduce(
        (sum, row) =>
          sum +
          (typeof row.values.totalGross === "number"
            ? row.values.totalGross
            : 0),
        0,
      ),
    ),
  };
}
