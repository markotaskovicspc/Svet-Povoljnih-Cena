import { useState, useEffect } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SKU } from "@/types";

export interface WishlistEntry {
  sku: SKU;
  notifyOnSale?: boolean;
  notifyOnRestock?: boolean;
  addedAt: string;
}

interface WishlistState {
  hydrated: boolean;
  items: WishlistEntry[];
  add: (sku: SKU) => void;
  remove: (sku: SKU) => void;
  toggle: (sku: SKU) => void;
  has: (sku: SKU) => boolean;
  setNotify: (sku: SKU, key: "notifyOnSale" | "notifyOnRestock", value: boolean) => void;
  count: () => number;
  clear: () => void;
}

export function useIsWished(sku: SKU): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const inWishlist = useWishlist((s) => s.has(sku));
  return mounted ? inWishlist : false;
}

export const useWishlist = create<WishlistState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      items: [],
      add: (sku) =>
        set((s) =>
          s.items.find((i) => i.sku === sku)
            ? s
            : { items: [...s.items, { sku, addedAt: new Date().toISOString() }] },
        ),
      remove: (sku) => set((s) => ({ items: s.items.filter((i) => i.sku !== sku) })),
      toggle: (sku) => {
        const exists = get().items.some((i) => i.sku === sku);
        if (exists) get().remove(sku);
        else get().add(sku);
      },
      has: (sku) => get().items.some((i) => i.sku === sku),
      setNotify: (sku, key, value) =>
        set((s) => ({
          items: s.items.map((i) => (i.sku === sku ? { ...i, [key]: value } : i)),
        })),
      count: () => get().items.length,
      clear: () => set({ items: [] }),
    }),
    {
      name: "spc-wishlist",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ items: s.items }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);
