"use client";

import { create } from "zustand";
import type { CartLine } from "./use-cart";
import type { SKU } from "@/types";

/**
 * Lightweight UI state for cart-related overlays.
 * Kept separate from `useCart` (which is persisted) so transient open/close
 * flags never end up in localStorage.
 */
interface CartUiState {
  addedItem: { line: CartLine; addedQty: number } | null;
  showAddedItem: (line: CartLine, addedQty: number) => void;
  closeAddedItem: () => void;
  drawerOpen: boolean;
  crossSellSku: SKU | null;
  suggestionDestination: string | null;
  wishlistOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  setDrawer: (open: boolean) => void;
  openCrossSell: (sku: SKU) => void;
  openSuggestion: (destination: string) => void;
  closeCrossSell: () => void;
  openWishlist: () => void;
  closeWishlist: () => void;
  setWishlist: (open: boolean) => void;
}

export const useCartUi = create<CartUiState>()((set) => ({
  addedItem: null,
  showAddedItem: (line, addedQty) => set({ addedItem: { line, addedQty }, drawerOpen: false, wishlistOpen: false, crossSellSku: null, suggestionDestination: null }),
  closeAddedItem: () => set({ addedItem: null }),
  drawerOpen: false,
  crossSellSku: null,
  suggestionDestination: null,
  wishlistOpen: false,
  openDrawer: () => set({ drawerOpen: true, addedItem: null }),
  closeDrawer: () => set({ drawerOpen: false }),
  setDrawer: (open) => set({ drawerOpen: open }),
  openCrossSell: (sku) => set({ crossSellSku: sku, addedItem: null }),
  openSuggestion: (destination) => set({ suggestionDestination: destination, addedItem: null }),
  closeCrossSell: () => set({ crossSellSku: null, suggestionDestination: null }),
  openWishlist: () => set({ wishlistOpen: true }),
  closeWishlist: () => set({ wishlistOpen: false }),
  setWishlist: (open) => set({ wishlistOpen: open }),
}));
