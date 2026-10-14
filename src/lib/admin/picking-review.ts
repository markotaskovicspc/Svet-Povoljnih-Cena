import type { PickingRow } from "./picking-plan";

type Review = { rows: PickingRow[]; progress: Record<string, number>; reviewedRows: string[] };

/** A shortage is a physical count, not permission to fulfill an arbitrary order. */
export function pickingReview(session: Review) {
  const reviewed = new Set(session.reviewedRows);
  const shortages = session.rows.flatMap(row => {
    const picked = session.progress[row.key] ?? 0;
    return picked < row.quantity ? [{ sku: row.sku, name: row.name, required: row.quantity, picked,
      missing: row.quantity - picked, orders: row.allocations.map(a => ({ number: a.orderNumber, quantity: a.quantity })) }] : [];
  });
  return {
    complete: session.rows.length > 0 && session.rows.every(row => (session.progress[row.key] ?? 0) === row.quantity),
    reviewed: session.rows.length > 0 && session.rows.every(row => reviewed.has(row.key) || (session.progress[row.key] ?? 0) === row.quantity),
    shortages,
  };
}

export function isMorningPickingTime(now: Date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Belgrade", hour: "2-digit", hourCycle: "h23" }).format(now) === "04";
}
