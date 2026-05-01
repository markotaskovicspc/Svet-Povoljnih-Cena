"use client";

/**
 * Infinite, GPU-friendly horizontal marquee. Two duplicated rows scroll left
 * via Framer's `animate` keyframes; pauses on hover and on reduced-motion.
 *
 * Used in the footer for partner / payment logos (Phase 1H.5).
 */
import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MarqueeProps {
  children: ReactNode;
  /** Seconds per full loop. */
  durationSec?: number;
  className?: string;
  pauseOnHover?: boolean;
  /** Soft fade mask on the edges. */
  fadeEdges?: boolean;
}

export function Marquee({
  children,
  durationSec = 30,
  className,
  pauseOnHover = true,
  fadeEdges = true,
}: MarqueeProps) {
  const reduced = useReducedMotion();

  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden",
        fadeEdges &&
          "[mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]",
        className,
      )}
      role="marquee"
      aria-live="off"
    >
      <motion.div
        className="flex w-max items-center gap-10"
        animate={reduced ? undefined : { x: ["0%", "-50%"] }}
        transition={
          reduced
            ? undefined
            : { duration: durationSec, ease: "linear", repeat: Infinity }
        }
        style={
          pauseOnHover
            ? { animationPlayState: "running" }
            : undefined
        }
        whileHover={pauseOnHover && !reduced ? { x: undefined } : undefined}
      >
        {/* Two copies → seamless loop when translated by -50%. */}
        <div className="flex shrink-0 items-center gap-10">{children}</div>
        <div aria-hidden className="flex shrink-0 items-center gap-10">
          {children}
        </div>
      </motion.div>
    </div>
  );
}
