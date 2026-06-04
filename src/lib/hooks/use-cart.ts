import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SKU } from "@/types";

export const MAX_CART_QTY = 99;

export interface CartLine {
  sku: SKU;
  name: string;
  slug: string;
  qty: number;
  unitPriceFull: number;
  unitPriceSale: number;
  thumbnailUrl?: string;
  withAssembly?: boolean;
  assemblyPrice?: number;
}

interface CartState {
  hydrated: boolean;
  lines: CartLine[];
  add: (line: Omit<CartLine, "qty">, qty?: number) => void;
  remove: (sku: SKU) => void;
  setQty: (sku: SKU, qty: number) => void;
  toggleAssembly: (sku: SKU) => void;
  clear: () => void;
  /** Derived helpers */
  count: () => number;
  subtotal: () => number;
  savings: () => number;
}

function normalizeQty(qty: unknown): number {
  const n = typeof qty === "number" ? qty : Number(qty);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_CART_QTY, Math.max(0, Math.floor(n)));
}

function normalizeMoney(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function normalizeCartLines(lines: unknown): CartLine[] {
  if (!Array.isArray(lines)) return [];

  const bySku = new Map<SKU, CartLine>();
  for (const item of lines) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<CartLine>;
    if (typeof row.sku !== "string" || !row.sku.trim()) continue;
    if (typeof row.name !== "string" || !row.name.trim()) continue;
    if (typeof row.slug !== "string" || !row.slug.trim()) continue;

    const qty = normalizeQty(row.qty);
    if (qty <= 0) continue;

    const sku = row.sku;
    const next: CartLine = {
      sku,
      name: row.name,
      slug: row.slug,
      qty,
      unitPriceFull: normalizeMoney(row.unitPriceFull),
      unitPriceSale: normalizeMoney(row.unitPriceSale),
      thumbnailUrl:
        typeof row.thumbnailUrl === "string" ? row.thumbnailUrl : undefined,
      withAssembly: Boolean(row.withAssembly),
      assemblyPrice:
        row.assemblyPrice == null ? undefined : normalizeMoney(row.assemblyPrice),
    };

    const existing = bySku.get(sku);
    bySku.set(
      sku,
      existing ? { ...next, qty: normalizeQty(existing.qty + next.qty) } : next,
    );
  }

  return Array.from(bySku.values());
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      lines: [],
      add: (line, qty = 1) =>
        set((s) => {
          const current = normalizeCartLines(s.lines);
          const addQty = normalizeQty(qty);
          if (addQty <= 0) {
            return { lines: current.filter((l) => l.sku !== line.sku) };
          }

          const existing = current.find((l) => l.sku === line.sku);
          if (existing) {
            return {
              lines: current.map((l) =>
                l.sku === line.sku
                  ? { ...l, ...line, qty: normalizeQty(l.qty + addQty) }
                  : l,
              ),
            };
          }
          return { lines: [...current, { ...line, qty: addQty }] };
        }),
      remove: (sku) =>
        set((s) => ({ lines: normalizeCartLines(s.lines).filter((l) => l.sku !== sku) })),
      setQty: (sku, qty) =>
        set((s) => {
          const current = normalizeCartLines(s.lines);
          const nextQty = normalizeQty(qty);
          if (nextQty <= 0) {
            return { lines: current.filter((l) => l.sku !== sku) };
          }
          return {
            lines: current.map((l) => (l.sku === sku ? { ...l, qty: nextQty } : l)),
          };
        }),
      toggleAssembly: (sku) =>
        set((s) => ({
          lines: normalizeCartLines(s.lines).map((l) =>
            l.sku === sku ? { ...l, withAssembly: !l.withAssembly } : l,
          ),
        })),
      clear: () => set({ lines: [] }),
      count: () => normalizeCartLines(get().lines).reduce((n, l) => n + l.qty, 0),
      subtotal: () =>
        normalizeCartLines(get().lines).reduce((n, l) => n + l.unitPriceSale * l.qty, 0),
      savings: () =>
        normalizeCartLines(get().lines).reduce(
          (n, l) => n + (l.unitPriceFull - l.unitPriceSale) * l.qty,
          0,
        ),
    }),
    {
      name: "spc-cart",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ lines: normalizeCartLines(s.lines) }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.lines = normalizeCartLines(state.lines);
          state.hydrated = true;
        }
      },
    },
  ),
);
