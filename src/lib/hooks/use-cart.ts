import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SKU } from "@/types";

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

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      lines: [],
      add: (line, qty = 1) =>
        set((s) => {
          const existing = s.lines.find((l) => l.sku === line.sku);
          if (existing) {
            return {
              lines: s.lines.map((l) =>
                l.sku === line.sku ? { ...l, qty: l.qty + qty } : l,
              ),
            };
          }
          return { lines: [...s.lines, { ...line, qty }] };
        }),
      remove: (sku) =>
        set((s) => ({ lines: s.lines.filter((l) => l.sku !== sku) })),
      setQty: (sku, qty) =>
        set((s) => {
          if (qty <= 0) {
            return { lines: s.lines.filter((l) => l.sku !== sku) };
          }
          return {
            lines: s.lines.map((l) => (l.sku === sku ? { ...l, qty } : l)),
          };
        }),
      toggleAssembly: (sku) =>
        set((s) => ({
          lines: s.lines.map((l) =>
            l.sku === sku ? { ...l, withAssembly: !l.withAssembly } : l,
          ),
        })),
      clear: () => set({ lines: [] }),
      count: () => get().lines.reduce((n, l) => n + l.qty, 0),
      subtotal: () =>
        get().lines.reduce((n, l) => n + l.unitPriceSale * l.qty, 0),
      savings: () =>
        get().lines.reduce(
          (n, l) => n + (l.unitPriceFull - l.unitPriceSale) * l.qty,
          0,
        ),
    }),
    {
      name: "spc-cart",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ lines: s.lines }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);
