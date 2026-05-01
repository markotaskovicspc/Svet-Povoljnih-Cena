"use client";

/**
 * Route-level page transition wrapper (Phase 1H.1).
 *
 * Uses Next.js App Router's `template.tsx` convention: a fresh React subtree
 * mounts on every navigation, so we get a clean enter animation per route.
 * AnimatePresence drives the exit/enter via pathname keying.
 *
 * - Easing: out-quint (matches design system).
 * - Reduced-motion users get a no-op pass-through.
 */
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();

  if (reduced) return <>{children}</>;

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
