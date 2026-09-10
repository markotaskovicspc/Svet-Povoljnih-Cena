import type { ReclamationStatus } from "@prisma/client";

export type ReclamationHistoryEntry = {
  number: string;
  createdAt: string;
  quantity: number;
  status: ReclamationStatus;
};

export type ReclamationItemOption = {
  sku: string;
  name: string;
  purchasedQty: number;
  reclamations: ReclamationHistoryEntry[];
};

export const reclamationHistorySelect = {
  number: true,
  createdAt: true,
  quantity: true,
  status: true,
} as const;

export function serializeReclamationHistory(
  rows: Array<Omit<ReclamationHistoryEntry, "createdAt"> & { createdAt: Date }>,
): ReclamationHistoryEntry[] {
  return rows
    .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Call while holding the order row lock, in the creation transaction. */
export function nextReclamationNumber(orderNumber: string, numbers: string[]) {
  let maximum = BigInt(0);
  for (const number of numbers) {
    const match = /^R-([0-9]+)-(.+)$/.exec(number);
    if (match?.[2] !== orderNumber) continue;
    const sequence = BigInt(match[1]);
    if (sequence > maximum) maximum = sequence;
  }
  return `R-${maximum + BigInt(1)}-${orderNumber}`;
}
