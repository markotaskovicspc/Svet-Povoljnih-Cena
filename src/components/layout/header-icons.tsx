"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, ShoppingBag } from "lucide-react";
import { useEffect, useRef } from "react";
import { useCart } from "@/lib/hooks/use-cart";
import { useWishlist } from "@/lib/hooks/use-wishlist";
import { useCartUi } from "@/lib/hooks/use-cart-ui";
import { cn } from "@/lib/utils";

function CountBadge({ count }: { count: number }) {
  return (
    <AnimatePresence>
      {count > 0 ? (
        <motion.span
          key={count}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-action px-1 font-mono text-[10px] leading-none text-canvas"
          aria-hidden
        >
          {count > 99 ? "99+" : count}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

export function WishlistButton({ className }: { className?: string }) {
  const items = useWishlist((s) => s.items);
  const hydrated = useWishlist((s) => s.hydrated);
  const count = hydrated ? items.length : 0;
  const openWishlist = useCartUi((s) => s.openWishlist);
  return (
    <Link
      href="/nalog/lista-zelja"
      aria-label={`Lista želja${count ? ` (${count})` : ""}`}
      onClick={(e) => {
        // On client: open the drawer instead of navigating. The href remains
        // for no-JS users / right-click "open in new tab".
        e.preventDefault();
        openWishlist();
      }}
      className={cn(
        "relative inline-flex size-10 items-center justify-center rounded-full text-ink-700 transition hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none",
        className,
      )}
    >
      <Heart className="size-5" aria-hidden />
      <CountBadge count={count} />
    </Link>
  );
}

export function CartButton({ className }: { className?: string }) {
  const lines = useCart((s) => s.lines);
  const hydrated = useCart((s) => s.hydrated);
  const count = hydrated ? lines.reduce((n, l) => n + l.qty, 0) : 0;

  // Animate "wiggle" whenever count increases
  const prev = useRef(count);
  const wiggleKey = useRef(0);
  if (count > prev.current) wiggleKey.current += 1;
  useEffect(() => {
    prev.current = count;
  }, [count]);

  const openDrawer = useCartUi((s) => s.openDrawer);

  return (
    <Link
      href="/korpa"
      aria-label={`Korpa${count ? ` (${count})` : ""}`}
      onClick={(e) => {
        e.preventDefault();
        openDrawer();
      }}
      className={cn(
        "relative inline-flex size-10 items-center justify-center rounded-full text-ink-700 transition hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none",
        className,
      )}
    >
      <motion.span
        key={wiggleKey.current}
        animate={
          wiggleKey.current
            ? { rotate: [0, -12, 10, -6, 0], scale: [1, 1.08, 1] }
            : undefined
        }
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="inline-flex"
      >
        <ShoppingBag className="size-5" aria-hidden />
      </motion.span>
      <CountBadge count={count} />
    </Link>
  );
}
