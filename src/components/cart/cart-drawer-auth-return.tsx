"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

import { useCartUi } from "@/lib/hooks/use-cart-ui";
import { consumeCartDrawerReturnMarker } from "@/lib/cart/cart-drawer-auth-return";

export function CartDrawerAuthReturn() {
  const pathname = usePathname();
  const { status } = useSession();
  const openDrawer = useCartUi((state) => state.openDrawer);

  useEffect(() => {
    if (status !== "authenticated") return;

    const cleanUrl = consumeCartDrawerReturnMarker(window.location.href);
    if (!cleanUrl) return;

    window.history.replaceState(window.history.state, "", cleanUrl);
    openDrawer();
  }, [openDrawer, pathname, status]);

  return null;
}
