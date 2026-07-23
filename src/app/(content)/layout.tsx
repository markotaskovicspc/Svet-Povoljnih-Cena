import type { ReactNode } from "react";
import { ScrollProgress } from "@/components/motion/scroll-progress";

/**
 * Shared chrome for editorial / static content pages (Phase 1G):
 * scroll-progress bar + container + breadcrumb slot is added per-page.
 */
export default function ContentLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ScrollProgress />
      {children}
    </>
  );
}
