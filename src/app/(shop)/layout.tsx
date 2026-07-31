import type { ReactNode } from "react";
import { StorefrontShell } from "@/components/layout/storefront-shell";

export default function ShopLayout({ children }: { children: ReactNode }) {
  return <StorefrontShell>{children}</StorefrontShell>;
}
