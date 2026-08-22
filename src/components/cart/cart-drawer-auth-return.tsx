"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { useCartUi } from "@/lib/hooks/use-cart-ui";
import { consumeCartDrawerReturnMarker } from "@/lib/cart/cart-drawer-auth-return";

export function CartDrawerAuthReturn() {
  const pathname = usePathname();
  const openDrawer = useCartUi((state) => state.openDrawer);

  useEffect(() => {
    // The server-action redirect has already completed authentication. Open
    // immediately instead of waiting for SessionProvider's follow-up request,
    // which can lag behind the returned page or remain stale after navigation.
    const cleanUrl = consumeCartDrawerReturnMarker(window.location.href);
    if (!cleanUrl) return;

    window.history.replaceState(window.history.state, "", cleanUrl);
    openDrawer();
  }, [openDrawer, pathname]);

  return null;
}
