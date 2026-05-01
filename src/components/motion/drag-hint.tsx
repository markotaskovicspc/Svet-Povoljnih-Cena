"use client";

/**
 * Cursor-following "Prevucite" pill, used inside horizontal scroll-snap rails.
 * Appears on hover when the rail actually overflows; hidden on reduced-motion
 * and on coarse-pointer devices (touch — no cursor to follow).
 */
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";
import { MoveHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function DragHint({
  scopeRef,
  label = "Prevucite",
}: {
  scopeRef: React.RefObject<HTMLElement | null>;
  label?: string;
}) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 250, damping: 25, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 250, damping: 25, mass: 0.4 });
  const [visible, setVisible] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const lastClientX = useRef(0);
  const lastClientY = useRef(0);

  useEffect(() => {
    const el = scopeRef.current;
    if (!el) return;
    if (reduced) return;
    const fine = window.matchMedia("(pointer: fine)").matches;
    if (!fine) return;

    const update = () => setEnabled(el.scrollWidth > el.clientWidth + 2);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);

    const onEnter = () => setVisible(true);
    const onLeave = () => setVisible(false);
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      lastClientX.current = e.clientX;
      lastClientY.current = e.clientY;
      x.set(e.clientX - rect.left);
      y.set(e.clientY - rect.top);
    };

    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    el.addEventListener("mousemove", onMove);
    return () => {
      ro.disconnect();
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
      el.removeEventListener("mousemove", onMove);
    };
  }, [scopeRef, reduced, x, y]);

  if (reduced || !enabled) return null;

  return (
    <motion.div
      aria-hidden
      initial={false}
      animate={{ opacity: visible ? 1 : 0, scale: visible ? 1 : 0.85 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      style={{ x: sx, y: sy }}
      className="pointer-events-none absolute top-0 left-0 z-10 -translate-x-1/2 -translate-y-1/2"
    >
      <span className="bg-ink-900/85 text-canvas inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px] tracking-wider uppercase backdrop-blur">
        <MoveHorizontal className="size-3.5" /> {label}
      </span>
    </motion.div>
  );
}
