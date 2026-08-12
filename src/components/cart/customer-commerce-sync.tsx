"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  normalizeCartLines,
  useCart,
  type CartLine,
} from "@/lib/hooks/use-cart";
import {
  normalizeWishlistItems,
  useWishlist,
  type WishlistEntry,
} from "@/lib/hooks/use-wishlist";

const OWNER_STORAGE_KEY = "spc-commerce-owner";
const WRITE_DELAY_MS = 350;

type RemoteWishlistItem = {
  sku: string;
  slug?: string;
  name?: string;
  fullPrice?: number;
  salePrice?: number | null;
  discountPct?: number;
  inStock?: boolean;
  incoming?: boolean;
  thumbnailUrl?: string | null;
  notifyOnSale?: boolean;
  notifyOnRestock?: boolean;
  addedAt?: string;
};

function remoteWishlistEntries(items: unknown): WishlistEntry[] {
  if (!Array.isArray(items)) return [];
  return normalizeWishlistItems(
    items.map((item: RemoteWishlistItem) => ({
      sku: item.sku,
      product: {
        sku: item.sku,
        slug: item.slug,
        name: item.name,
        fullPrice: item.fullPrice,
        effectivePrice: item.salePrice ?? item.fullPrice,
        discountPct: item.discountPct,
        inStock: item.inStock,
        incoming: item.incoming,
        thumbnailUrl: item.thumbnailUrl,
      },
      notifyOnSale: item.notifyOnSale,
      notifyOnRestock: item.notifyOnRestock,
      addedAt: item.addedAt,
    })),
  );
}

export function mergeGuestCart(
  localLines: CartLine[],
  serverLines: CartLine[],
) {
  const server = normalizeCartLines(serverLines);
  const serverSkus = new Set(server.map((line) => line.sku));
  return normalizeCartLines([
    ...server,
    ...normalizeCartLines(localLines).filter((line) => !serverSkus.has(line.sku)),
  ]);
}

export function mergeGuestWishlist(
  localItems: WishlistEntry[],
  serverItems: WishlistEntry[],
) {
  const localBySku = new Map(
    normalizeWishlistItems(localItems).map((item) => [item.sku, item]),
  );
  const merged = normalizeWishlistItems(serverItems).map((item) => {
    const local = localBySku.get(item.sku);
    localBySku.delete(item.sku);
    return local
      ? {
          ...local,
          ...item,
          notifyOnSale: Boolean(item.notifyOnSale || local.notifyOnSale),
          notifyOnRestock: Boolean(
            item.notifyOnRestock || local.notifyOnRestock,
          ),
        }
      : item;
  });
  return normalizeWishlistItems([...merged, ...localBySku.values()]);
}

/**
 * Keeps local, durable browser state in sync with the authenticated customer's
 * database copy. Guest items are merged once on first login; an existing
 * account copy is otherwise authoritative so deletions made on another device
 * are not accidentally resurrected.
 */
export function CustomerCommerceSync() {
  const { data: session, status } = useSession();
  const cartHydrated = useCart((state) => state.hydrated);
  const wishlistHydrated = useWishlist((state) => state.hydrated);

  useEffect(() => {
    if (
      status !== "authenticated" ||
      session.user.userType !== "customer" ||
      !cartHydrated ||
      !wishlistHydrated
    ) {
      return;
    }

    const userId = session.user.id;
    let disposed = false;
    let applyingRemote = false;
    let cartTimer: ReturnType<typeof setTimeout> | null = null;
    let wishlistTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeCart = () => {};
    let unsubscribeWishlist = () => {};
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(`spc-commerce:${userId}`);

    const saveCart = async (announce = true) => {
      const response = await fetch("/api/cart", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: normalizeCartLines(useCart.getState().lines) }),
      }).catch(() => null);
      if (announce && response?.ok) channel?.postMessage("cart");
      return Boolean(response?.ok);
    };

    const saveWishlist = async (announce = true) => {
      const items = normalizeWishlistItems(useWishlist.getState().items).map(
        (item) => ({
          sku: item.sku,
          notifyOnSale: Boolean(item.notifyOnSale),
          notifyOnRestock: Boolean(item.notifyOnRestock),
        }),
      );
      const response = await fetch("/api/wishlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      }).catch(() => null);
      if (announce && response?.ok) channel?.postMessage("wishlist");
      return Boolean(response?.ok);
    };

    const loadRemote = async () => {
      const [cartResponse, wishlistResponse] = await Promise.all([
        fetch("/api/cart", { cache: "no-store" }).catch(() => null),
        fetch("/api/wishlist", { cache: "no-store" }).catch(() => null),
      ]);
      if (!cartResponse?.ok || !wishlistResponse?.ok) return null;
      const [cartPayload, wishlistPayload] = await Promise.all([
        cartResponse.json().catch(() => null),
        wishlistResponse.json().catch(() => null),
      ]);
      return {
        cart: normalizeCartLines(cartPayload?.lines),
        wishlist: remoteWishlistEntries(wishlistPayload?.items),
      };
    };

    const applyRemote = (remote: {
      cart: CartLine[];
      wishlist: WishlistEntry[];
    }) => {
      applyingRemote = true;
      useCart.setState({ lines: remote.cart });
      useWishlist.setState({ items: remote.wishlist });
      applyingRemote = false;
    };

    const refreshFromServer = async () => {
      if (cartTimer || wishlistTimer) return;
      const remote = await loadRemote();
      if (!disposed && remote) applyRemote(remote);
    };

    const initialize = async () => {
      const remote = await loadRemote();
      if (disposed || !remote) return;

      const previousOwner = window.localStorage.getItem(OWNER_STORAGE_KEY);
      const mergeGuestState = previousOwner === null;
      const next = mergeGuestState
        ? {
            cart: mergeGuestCart(useCart.getState().lines, remote.cart),
            wishlist: mergeGuestWishlist(
              useWishlist.getState().items,
              remote.wishlist,
            ),
          }
        : remote;
      applyRemote(next);
      window.localStorage.setItem(OWNER_STORAGE_KEY, userId);

      if (mergeGuestState) {
        await Promise.all([saveCart(false), saveWishlist(false)]);
      }
      if (disposed) return;

      unsubscribeCart = useCart.subscribe((state, previous) => {
        if (applyingRemote || state.lines === previous.lines) return;
        if (cartTimer) clearTimeout(cartTimer);
        cartTimer = setTimeout(() => {
          cartTimer = null;
          void saveCart();
        }, WRITE_DELAY_MS);
      });
      unsubscribeWishlist = useWishlist.subscribe((state, previous) => {
        if (applyingRemote || state.items === previous.items) return;
        if (wishlistTimer) clearTimeout(wishlistTimer);
        wishlistTimer = setTimeout(() => {
          wishlistTimer = null;
          void saveWishlist();
        }, WRITE_DELAY_MS);
      });
    };

    const onFocus = () => void refreshFromServer();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshFromServer();
    };
    const onOnline = () => {
      void Promise.all([saveCart(), saveWishlist()]);
    };
    const onChannelMessage = () => void refreshFromServer();

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    channel?.addEventListener("message", onChannelMessage);
    void initialize();

    return () => {
      disposed = true;
      if (cartTimer) clearTimeout(cartTimer);
      if (wishlistTimer) clearTimeout(wishlistTimer);
      unsubscribeCart();
      unsubscribeWishlist();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      channel?.removeEventListener("message", onChannelMessage);
      channel?.close();
    };
  }, [cartHydrated, session, status, wishlistHydrated]);

  return null;
}
