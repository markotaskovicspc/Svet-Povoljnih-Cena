"use client";

import { useEffect, useRef } from "react";
import Lenis from "lenis";

/**
 * Smooth-scroll provider built on Lenis.
 * Disabled automatically when the user prefers reduced motion.
 */
export function LenisProvider({ children }: { children: React.ReactNode }) {
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const lenis = new Lenis({
      lerp: 0.1,
      wheelMultiplier: 1,
      smoothWheel: true,
    });

    const raf = (time: number) => {
      lenis.raf(time);
      rafRef.current = requestAnimationFrame(raf);
    };
    rafRef.current = requestAnimationFrame(raf);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}
