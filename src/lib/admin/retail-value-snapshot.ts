export type RetailValueSnapshotItem = {
  sourceItemId: string;
  productId: string;
  sku: string;
  qty: number;
  unitMpc: number;
};

export type RetailValueSnapshot = {
  version: 1;
  bookedAt: string;
  items: RetailValueSnapshotItem[];
};

type SnapshotInput = {
  bookedAt: Date;
  items: Array<{
    id: string;
    productId: string | null;
    sku: string;
    qty: number;
  }>;
  priceByProductId: ReadonlyMap<string, number>;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildRetailValueSnapshot({
  bookedAt,
  items,
  priceByProductId,
}: SnapshotInput): RetailValueSnapshot {
  const missing: string[] = [];
  const snapshotItems: RetailValueSnapshotItem[] = [];

  for (const item of items) {
    if (!Number.isInteger(item.qty) || item.qty <= 0) {
      throw new Error(`Količina za ${item.sku} mora biti pozitivan ceo broj.`);
    }
    const unitMpc = item.productId
      ? priceByProductId.get(item.productId)
      : undefined;
    if (!item.productId || unitMpc === undefined || !Number.isFinite(unitMpc) || unitMpc <= 0) {
      missing.push(item.sku);
      continue;
    }
    snapshotItems.push({
      sourceItemId: item.id,
      productId: item.productId,
      sku: item.sku,
      qty: item.qty,
      unitMpc: roundMoney(unitMpc),
    });
  }

  if (missing.length) {
    throw new Error(
      `Knjiženje je blokirano: unesite aktivnu MP cenu za sve artikle. Nedostaje za: ${[...new Set(missing)].join(", ")}.`,
    );
  }

  return {
    version: 1,
    bookedAt: bookedAt.toISOString(),
    items: snapshotItems,
  };
}

export function readRetailValueSnapshot(value: unknown): RetailValueSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    typeof candidate.bookedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.bookedAt)) ||
    !Array.isArray(candidate.items)
  ) {
    return null;
  }
  const items: RetailValueSnapshotItem[] = [];
  for (const value of candidate.items) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    if (
      typeof item.sourceItemId !== "string" ||
      typeof item.productId !== "string" ||
      typeof item.sku !== "string" ||
      !Number.isInteger(item.qty) ||
      Number(item.qty) <= 0 ||
      typeof item.unitMpc !== "number" ||
      !Number.isFinite(item.unitMpc) ||
      item.unitMpc <= 0
    ) {
      return null;
    }
    items.push({
      sourceItemId: item.sourceItemId,
      productId: item.productId,
      sku: item.sku,
      qty: Number(item.qty),
      unitMpc: roundMoney(item.unitMpc),
    });
  }
  return { version: 1, bookedAt: candidate.bookedAt, items };
}

export function retailValueSnapshotTotal(snapshot: RetailValueSnapshot) {
  return roundMoney(
    snapshot.items.reduce((total, item) => total + item.qty * item.unitMpc, 0),
  );
}
