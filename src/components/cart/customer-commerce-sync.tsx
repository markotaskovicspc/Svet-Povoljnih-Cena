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
const CART_STORAGE_KEY = "spc-cart";
const WISHLIST_STORAGE_KEY = "spc-wishlist";
const WRITE_DELAY_MS = 350;

type RemoteWishlistItem = {
  sku: string;
  slug?: string;
  name?: string;
  fullPrice?: number;
  salePrice?: number | null;
  actionPrice?: number | null;
  loyaltyPrice?: number | null;
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
        actionPrice: item.actionPrice ?? item.salePrice ?? undefined,
        loyaltyPrice: item.loyaltyPrice ?? undefined,
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

function persistedStateField(raw: string | null, field: string): unknown {
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as { state?: Record<string, unknown> };
    return payload?.state?.[field] ?? null;
  } catch {
    return null;
  }
}

export function persistedCartLines(raw: string | null): CartLine[] | null {
  const lines = persistedStateField(raw, "lines");
  return Array.isArray(lines) ? normalizeCartLines(lines) : null;
}

export function persistedWishlistItems(
  raw: string | null,
): WishlistEntry[] | null {
  const items = persistedStateField(raw, "items");
  return Array.isArray(items) ? normalizeWishlistItems(items) : null;
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

export async function persistGuestCommerce(
  snapshot: { cart: CartLine[]; wishlist: WishlistEntry[] },
  persist: {
    cart: (lines: CartLine[]) => Promise<boolean>;
    wishlist: (items: WishlistEntry[]) => Promise<boolean>;
  },
) {
  const [cartSaved, wishlistSaved] = await Promise.all([
    persist.cart(snapshot.cart),
    persist.wishlist(snapshot.wishlist),
  ]);
  return cartSaved && wishlistSaved;
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
  const customerId =
    status === "authenticated" && session?.user.userType === "customer"
      ? session.user.id
      : null;

  useEffect(() => {
    if (
      status === "unauthenticated" &&
      cartHydrated &&
      wishlistHydrated
    ) {
      window.localStorage.setItem(OWNER_STORAGE_KEY, "guest");
      return;
    }
    if (
      !customerId ||
      !cartHydrated ||
      !wishlistHydrated
    ) {
      return;
    }

    const userId = customerId;
    let disposed = false;
    let initialized = false;
    let initializing = false;
    let refreshing = false;
    let applyingRemote = false;
    let cartTimer: ReturnType<typeof setTimeout> | null = null;
    let wishlistTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeCart = () => {};
    let unsubscribeWishlist = () => {};
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(`spc-commerce:${userId}`);

    const saveCart = async (
      lines = normalizeCartLines(useCart.getState().lines),
      announce = true,
    ) => {
      const response = await fetch("/api/cart", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-SPC-Cart-Sync": announce ? "replace" : "merge",
        },
        body: JSON.stringify({ lines: normalizeCartLines(lines) }),
      }).catch(() => null);
      if (announce && response?.ok) channel?.postMessage("cart");
      return Boolean(response?.ok);
    };

    const saveWishlist = async (
      wishlist = normalizeWishlistItems(useWishlist.getState().items),
      announce = true,
    ) => {
      const items = normalizeWishlistItems(wishlist).map(
        (item) => ({
          sku: item.sku,
          notifyOnSale: Boolean(item.notifyOnSale),
          notifyOnRestock: Boolean(item.notifyOnRestock),
        }),
      );
      const response = await fetch("/api/wishlist", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-SPC-Wishlist-Sync": announce ? "replace" : "merge",
        },
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
      if (!initialized || refreshing || cartTimer || wishlistTimer) return;
      refreshing = true;
      const cartBeforeRefresh = useCart.getState().lines;
      const wishlistBeforeRefresh = useWishlist.getState().items;
      const remote = await loadRemote();
      refreshing = false;
      if (
        !disposed &&
        remote &&
        !cartTimer &&
        !wishlistTimer &&
        useCart.getState().lines === cartBeforeRefresh &&
        useWishlist.getState().items === wishlistBeforeRefresh
      ) {
        applyRemote(remote);
      }
    };

    const initialize = async () => {
      if (disposed || initialized || initializing) return;
      initializing = true;
      const previousOwner = window.localStorage.getItem(OWNER_STORAGE_KEY);
      const mergeGuestState = previousOwner === null || previousOwner === "guest";
      // localStorage is shared across tabs while each Zustand instance is not.
      // Capture the persisted guest snapshot before any auth-driven repricing
      // in a stale tab can write its older in-memory copy back to storage.
      const guestSnapshot = mergeGuestState
        ? {
            cart:
              persistedCartLines(
                window.localStorage.getItem(CART_STORAGE_KEY),
              ) ?? normalizeCartLines(useCart.getState().lines),
            wishlist:
              persistedWishlistItems(
                window.localStorage.getItem(WISHLIST_STORAGE_KEY),
              ) ?? normalizeWishlistItems(useWishlist.getState().items),
          }
        : null;
      const remote = await loadRemote();
      if (disposed || !remote) {
        initializing = false;
        return;
      }

      const next = mergeGuestState
        ? {
            cart: mergeGuestCart(guestSnapshot?.cart ?? [], remote.cart),
            wishlist: mergeGuestWishlist(
              guestSnapshot?.wishlist ?? [],
              remote.wishlist,
            ),
          }
        : remote;
      applyRemote(next);

      if (mergeGuestState) {
        let cartSnapshot = useCart.getState().lines;
        let wishlistSnapshot = useWishlist.getState().items;
        let guestStateSaved = false;

        // Keep the browser in guest mode until the exact current snapshot is
        // durable. A session refresh before that point must merge and retry,
        // never replace these items with an older server copy.
        while (!disposed) {
          const snapshotSaved = await persistGuestCommerce(
            { cart: cartSnapshot, wishlist: wishlistSnapshot },
            {
              cart: (lines) => saveCart(lines, false),
              wishlist: (items) => saveWishlist(items, false),
            },
          );
          if (!snapshotSaved || disposed) break;

          const currentCart = useCart.getState().lines;
          const currentWishlist = useWishlist.getState().items;
          if (
            currentCart === cartSnapshot &&
            currentWishlist === wishlistSnapshot
          ) {
            guestStateSaved = true;
            break;
          }
          cartSnapshot = currentCart;
          wishlistSnapshot = currentWishlist;
        }

        if (disposed) {
          initializing = false;
          return;
        }
        window.localStorage.setItem(
          OWNER_STORAGE_KEY,
          guestStateSaved ? userId : "guest",
        );
        if (!guestStateSaved) {
          initializing = false;
          return;
        }
      } else {
        window.localStorage.setItem(OWNER_STORAGE_KEY, userId);
      }
      if (disposed) return;

      unsubscribeCart = useCart.subscribe((state, previous) => {
        if (applyingRemote || state.lines === previous.lines) return;
        if (cartTimer) clearTimeout(cartTimer);
        cartTimer = setTimeout(() => {
          cartTimer = null;
          void saveCart(undefined, true);
        }, WRITE_DELAY_MS);
      });
      unsubscribeWishlist = useWishlist.subscribe((state, previous) => {
        if (applyingRemote || state.items === previous.items) return;
        if (wishlistTimer) clearTimeout(wishlistTimer);
        wishlistTimer = setTimeout(() => {
          wishlistTimer = null;
          void saveWishlist(undefined, true);
        }, WRITE_DELAY_MS);
      });
      initialized = true;
      initializing = false;
    };

    const synchronize = () => {
      if (initialized) void refreshFromServer();
      else void initialize();
    };
    const onFocus = () => synchronize();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") synchronize();
    };
    const onOnline = () => {
      if (!initialized) {
        void initialize();
        return;
      }
      void Promise.all([
        saveCart(undefined, true),
        saveWishlist(undefined, true),
      ]);
    };
    const onChannelMessage = () => synchronize();

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
  }, [cartHydrated, customerId, status, wishlistHydrated]);

  return null;
}
