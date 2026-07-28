const DAY_MS = 86_400_000;

const CLOSED_STATUSES = new Set(["RESENO", "ODBIJENO"]);

export type ReclamationAnalyticsRow = {
  id: string;
  sku: string;
  status: string;
  type: string | null;
  resolution: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  productName: string;
  supplier: string;
};

export type DeliveredSupplierRow = {
  supplier: string;
  deliveredItems: number;
};

export type DeliveredProductRow = {
  sku: string;
  deliveredItems: number;
};

export type ReclamationBreakdown = {
  key: string;
  count: number;
};

export type ReclamationMetrics = {
  total: number;
  deliveredItems: number;
  reclamationRate: number;
  byType: ReclamationBreakdown[];
  byResolution: ReclamationBreakdown[];
  resolved: number;
  unresolved: number;
  unresolvedOver5Days: number;
  unresolvedOver10Days: number;
  unresolvedOver20Days: number;
  unresolvedOver30Days: number;
  averageResolutionDays: number | null;
};

export type SupplierReclamationMetrics = ReclamationMetrics & {
  supplier: string;
};

export type TopReclamationProduct = {
  sku: string;
  productName: string;
  supplier: string;
  reclamations: number;
  deliveredItems: number;
  reclamationRate: number;
};

export type ReclamationAnalytics = {
  totals: ReclamationMetrics;
  suppliers: SupplierReclamationMetrics[];
  topProducts: TopReclamationProduct[];
};

export function buildReclamationAnalytics(
  reclamations: ReclamationAnalyticsRow[],
  deliveredBySupplier: DeliveredSupplierRow[],
  deliveredByProduct: DeliveredProductRow[],
  now = new Date(),
): ReclamationAnalytics {
  const supplierDelivered = new Map(
    deliveredBySupplier.map((row) => [row.supplier, row.deliveredItems]),
  );
  const productDelivered = new Map(
    deliveredByProduct.map((row) => [row.sku, row.deliveredItems]),
  );
  const deliveredItems = deliveredBySupplier.reduce(
    (sum, row) => sum + row.deliveredItems,
    0,
  );

  const reclamationsBySupplier = groupBy(reclamations, (row) => row.supplier);
  const suppliers = Array.from(reclamationsBySupplier, ([supplier, rows]) => ({
    supplier,
    ...summarize(rows, supplierDelivered.get(supplier) ?? 0, now),
  })).sort(
    (left, right) =>
      right.total - left.total || left.supplier.localeCompare(right.supplier, "sr-Latn-RS"),
  );

  const reclamationsBySku = groupBy(reclamations, (row) => row.sku);
  const topProducts = Array.from(reclamationsBySku, ([sku, rows]) => {
    const delivered = productDelivered.get(sku) ?? 0;
    return {
      sku,
      productName: mostFrequent(rows.map((row) => row.productName)),
      supplier: mostFrequent(rows.map((row) => row.supplier)),
      reclamations: rows.length,
      deliveredItems: delivered,
      reclamationRate: percentage(rows.length, delivered),
    };
  })
    .sort(
      (left, right) =>
        right.reclamations - left.reclamations || left.sku.localeCompare(right.sku),
    )
    .slice(0, 20);

  return {
    totals: summarize(reclamations, deliveredItems, now),
    suppliers,
    topProducts,
  };
}

function summarize(
  reclamations: ReclamationAnalyticsRow[],
  deliveredItems: number,
  now: Date,
): ReclamationMetrics {
  const unresolvedRows = reclamations.filter(
    (row) => !CLOSED_STATUSES.has(row.status),
  );
  const resolvedDurations = reclamations.flatMap((row) => {
    if (!row.resolvedAt) return [];
    const duration = (row.resolvedAt.getTime() - row.createdAt.getTime()) / DAY_MS;
    return duration >= 0 ? [duration] : [];
  });

  return {
    total: reclamations.length,
    deliveredItems,
    reclamationRate: percentage(reclamations.length, deliveredItems),
    byType: countBy(reclamations, (row) => row.type ?? "NIJE_UNETO"),
    byResolution: countBy(
      reclamations,
      (row) => row.resolution ?? "NIJE_UNETO",
    ),
    resolved: reclamations.length - unresolvedRows.length,
    unresolved: unresolvedRows.length,
    unresolvedOver5Days: olderThan(unresolvedRows, 5, now),
    unresolvedOver10Days: olderThan(unresolvedRows, 10, now),
    unresolvedOver20Days: olderThan(unresolvedRows, 20, now),
    unresolvedOver30Days: olderThan(unresolvedRows, 30, now),
    averageResolutionDays: resolvedDurations.length
      ? resolvedDurations.reduce((sum, duration) => sum + duration, 0) /
        resolvedDurations.length
      : null,
  };
}

function olderThan(
  rows: ReclamationAnalyticsRow[],
  days: number,
  now: Date,
): number {
  return rows.filter(
    (row) => (now.getTime() - row.createdAt.getTime()) / DAY_MS > days,
  ).length;
}

function percentage(count: number, total: number) {
  return total > 0 ? (count / total) * 100 : 0;
}

function countBy(
  rows: ReclamationAnalyticsRow[],
  keyFor: (row: ReclamationAnalyticsRow) => string,
): ReclamationBreakdown[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFor(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([key, count]) => ({ key, count })).sort(
    (left, right) => right.count - left.count || left.key.localeCompare(right.key),
  );
}

function groupBy<T>(rows: T[], keyFor: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

function mostFrequent(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return (
    Array.from(counts.entries()).sort(
      ([leftValue, leftCount], [rightValue, rightCount]) =>
        rightCount - leftCount || leftValue.localeCompare(rightValue, "sr-Latn-RS"),
    )[0]?.[0] ?? "—"
  );
}
