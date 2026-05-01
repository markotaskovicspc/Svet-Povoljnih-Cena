"use client";

import { create } from "zustand";
import type { SKU } from "@/types";

/**
 * Lightweight UI state for cart-related overlays.
 * Kept separate from `useCart` (which is persisted) so transient open/close
 * flags never end up in localStorage.
 */
interface CartUiState {
  drawerOpen: boolean;
  crossSellSku: SKU | null;
  wishlistOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  setDrawer: (open: boolean) => void;
  openCrossSell: (sku: SKU) => void;
  closeCrossSell: () => void;
  openWishlist: () => void;
  closeWishlist: () => void;
  setWishlist: (open: boolean) => void;
}

export const useCartUi = create<CartUiState>()((set) => ({
  drawerOpen: false,
  crossSellSku: null,
  wishlistOpen: false,
  openDrawer: () => set({ drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false }),
  setDrawer: (open) => set({ drawerOpen: open }),
  openCrossSell: (sku) => set({ crossSellSku: sku }),
  closeCrossSell: () => set({ crossSellSku: null }),
  openWishlist: () => set({ wishlistOpen: true }),
  closeWishlist: () => set({ wishlistOpen: false }),
  setWishlist: (open) => set({ wishlistOpen: open }),
}));
