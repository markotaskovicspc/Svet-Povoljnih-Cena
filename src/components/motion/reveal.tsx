"use client";

/**
 * Generic scroll-reveal wrapper. 12px Y offset, opacity 0→1, runs once.
 * Honors prefers-reduced-motion via Framer's useReducedMotion (no-op when reduced).
 */
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";

type RevealProps = Omit<HTMLMotionProps<"div">, "children"> & {
  delay?: number;
  amount?: number;
  className?: string;
  children?: ReactNode;
};

export function Reveal({
  delay = 0,
  amount = 0.3,
  children,
  className,
  ...rest
}: RevealProps) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
