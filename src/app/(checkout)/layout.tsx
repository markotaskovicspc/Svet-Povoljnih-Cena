/**
 * Checkout-route layout. Renders inside the global header/footer (not stripped),
 * adds a focus-mode top bar with the secure-checkout badge.
 */
import type { ReactNode } from "react";
import { StorefrontShell } from "@/components/layout/storefront-shell";

export default function CheckoutLayout({ children }: { children: ReactNode }) {
  return (
    <StorefrontShell>
      <div className="bg-canvas">{children}</div>
    </StorefrontShell>
  );
}
