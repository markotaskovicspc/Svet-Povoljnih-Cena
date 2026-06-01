"use client";

import { useEffect, useRef } from "react";
import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { CrossSellModal } from "@/components/cart/cross-sell-modal";
import { WishlistDrawer } from "@/components/cart/wishlist-drawer";
import { useCartUi } from "@/lib/hooks/use-cart-ui";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      <MotionConfig reducedMotion="user">
        <TooltipProvider delay={150}>
          {children}
          <CartDrawer />
          <WishlistDrawer />
          <CrossSellModal />
          <CartOverlayHistoryBridge />
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            toastOptions={{ duration: 4000 }}
          />
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}

function CartOverlayHistoryBridge() {
  const drawerOpen = useCartUi((s) => s.drawerOpen);
  const wishlistOpen = useCartUi((s) => s.wishlistOpen);
  const crossSellSku = useCartUi((s) => s.crossSellSku);
  const suggestionDestination = useCartUi((s) => s.suggestionDestination);
  const closeDrawer = useCartUi((s) => s.closeDrawer);
  const closeWishlist = useCartUi((s) => s.closeWishlist);
  const closeCrossSell = useCartUi((s) => s.closeCrossSell);
  const pushedOverlay = useRef(false);
  const overlayOpen = drawerOpen || wishlistOpen || Boolean(crossSellSku || suggestionDestination);

  useEffect(() => {
    if (!overlayOpen || pushedOverlay.current) return;
    window.history.pushState({ spcCartOverlay: true }, "", window.location.href);
    pushedOverlay.current = true;
  }, [overlayOpen]);

  useEffect(() => {
    if (!overlayOpen) {
      pushedOverlay.current = false;
      return;
    }

    const onPopState = () => {
      if (suggestionDestination || crossSellSku) closeCrossSell();
      else if (drawerOpen) closeDrawer();
      else if (wishlistOpen) closeWishlist();
      pushedOverlay.current = false;
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [
    closeCrossSell,
    closeDrawer,
    closeWishlist,
    crossSellSku,
    drawerOpen,
    overlayOpen,
    suggestionDestination,
    wishlistOpen,
  ]);

  return null;
}
