import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Product, SKU, WishlistProductSnapshot } from "@/types";
import { getMediaVariantUrl } from "@/lib/media";
import { effectiveUnitPrice } from "@/lib/pricing";

export interface WishlistEntry {
  sku: SKU;
  product?: WishlistProductSnapshot;
  notifyOnSale?: boolean;
  notifyOnRestock?: boolean;
  addedAt: string;
}

interface WishlistState {
  hydrated: boolean;
  items: WishlistEntry[];
  enrichMissing: () => Promise<void>;
  add: (sku: SKU, product?: WishlistProductSnapshot) => void;
  addProduct: (product: Product) => void;
  remove: (sku: SKU) => void;
  toggle: (sku: SKU, product?: WishlistProductSnapshot) => void;
  toggleProduct: (product: Product) => void;
  has: (sku: SKU) => boolean;
  setNotify: (sku: SKU, key: "notifyOnSale" | "notifyOnRestock", value: boolean) => void;
  count: () => number;
  clear: () => void;
}

export function useIsWished(sku: SKU): boolean {
  const hydrated = useWishlist((s) => s.hydrated);
  const inWishlist = useWishlist((s) => s.has(sku));
  return hydrated ? inWishlist : false;
}

export const useWishlist = create<WishlistState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      items: [],
      enrichMissing: async () => {
        const missing = get().items
          .filter((item) => !item.product?.name)
          .map((item) => item.sku);
        if (!missing.length) return;
        const response = await fetch("/api/products/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skus: missing }),
        }).catch(() => null);
        if (!response?.ok) return;
        const payload = (await response.json().catch(() => null)) as
          | { items?: WishlistProductSnapshot[] }
          | null;
        const snapshots = new Map(
          (payload?.items ?? []).map((product) => [product.sku, product]),
        );
        if (!snapshots.size) return;
        set((s) => ({
          items: s.items.map((item) => ({
            ...item,
            product: snapshots.get(item.sku) ?? item.product,
          })),
        }));
      },
      add: (sku, product) =>
        set((s) =>
          s.items.find((i) => i.sku === sku)
            ? s
            : {
                items: [
                  ...s.items,
                  { sku, product, addedAt: new Date().toISOString() },
                ],
              },
        ),
      addProduct: (product) => get().add(product.sku, wishlistSnapshotFromProduct(product)),
      remove: (sku) => set((s) => ({ items: s.items.filter((i) => i.sku !== sku) })),
      toggle: (sku, product) => {
        const exists = get().items.some((i) => i.sku === sku);
        if (exists) get().remove(sku);
        else get().add(sku, product);
      },
      toggleProduct: (product) =>
        get().toggle(product.sku, wishlistSnapshotFromProduct(product)),
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
        if (state) {
          state.items = normalizeWishlistItems(state.items);
          state.hydrated = true;
        }
      },
    },
  ),
);

export function wishlistSnapshotFromProduct(product: Product): WishlistProductSnapshot {
  const price = effectiveUnitPrice(product);
  return {
    sku: product.sku,
    slug: product.slug,
    name: product.name,
    fullPrice: price.full,
    effectivePrice: price.effective,
    discountPct: product.discountPct,
    inStock: product.stock > 0,
    incoming: product.incomingStock > 0,
    thumbnailUrl: getMediaVariantUrl(product.media.images[0], "thumb") || null,
  };
}

function normalizeWishlistItems(items: unknown): WishlistEntry[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item): WishlistEntry | null => {
      if (typeof item === "string" && item.trim()) {
        return { sku: item, addedAt: new Date().toISOString() };
      }
      if (!item || typeof item !== "object" || !("sku" in item)) return null;
      const row = item as Partial<WishlistEntry>;
      if (typeof row.sku !== "string" || !row.sku.trim()) return null;
      return {
        sku: row.sku,
        product: row.product,
        notifyOnSale: Boolean(row.notifyOnSale),
        notifyOnRestock: Boolean(row.notifyOnRestock),
        addedAt:
          typeof row.addedAt === "string"
            ? row.addedAt
            : new Date().toISOString(),
      };
    })
    .filter((item): item is WishlistEntry => Boolean(item));
}
