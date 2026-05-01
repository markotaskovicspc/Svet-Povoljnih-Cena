"use client";

import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LenisProvider } from "@/components/motion/lenis-provider";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { CrossSellModal } from "@/components/cart/cross-sell-modal";
import { WishlistDrawer } from "@/components/cart/wishlist-drawer";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      <MotionConfig reducedMotion="user">
        <LenisProvider>
            <TooltipProvider delay={150}>
            {children}
            <CartDrawer />
            <WishlistDrawer />
            <CrossSellModal />
            <Toaster
              position="bottom-right"
              richColors
              closeButton
              toastOptions={{ duration: 4000 }}
            />
          </TooltipProvider>
        </LenisProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
