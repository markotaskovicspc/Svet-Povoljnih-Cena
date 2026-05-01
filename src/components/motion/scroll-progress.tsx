"use client";

/**
 * Thin progress bar pinned to the top of long content pages.
 * Bound to scrollYProgress; honors prefers-reduced-motion (renders nothing).
 */
import { motion, useReducedMotion, useScroll, useSpring } from "framer-motion";

export function ScrollProgress() {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const x = useSpring(scrollYProgress, { stiffness: 120, damping: 24, mass: 0.4 });

  if (reduced) return null;

  return (
    <motion.div
      aria-hidden
      className="bg-walnut pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px] origin-left"
      style={{ scaleX: x }}
    />
  );
}
