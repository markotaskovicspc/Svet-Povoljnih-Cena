"use client";

/**
 * Section rail — title + "Prikaži sve →" + horizontal snap rail of product cards.
 * Used for Heroji meseca, Mesečna akcija, Nedeljne akcije, and Ostali tabovi.
 */
import Link from "next/link";
import { useRef } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import type { Product } from "@/types";
import { ProductCard } from "@/components/product/product-card";
import { DragHint } from "@/components/motion/drag-hint";

interface SectionRailProps {
  eyebrow?: string;
  title: string;
  description?: string;
  href: string;
  ctaLabel?: string;
  products: Product[];
}

export function SectionRail({
  eyebrow,
  title,
  description,
  href,
  ctaLabel = "Prikaži sve",
  products,
}: SectionRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  if (!products.length) return null;

  return (
    <section className="mx-auto w-full max-w-[var(--container-page)] px-6 py-12 md:py-20">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl"
        >
          {eyebrow ? (
            <p className="font-mono text-xs tracking-[0.2em] text-walnut uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="font-display mt-2 text-3xl text-ink-900 md:text-4xl">
            {title}
          </h2>
          {description ? (
            <p className="mt-3 max-w-prose text-base text-ink-700">{description}</p>
          ) : null}
        </motion.div>
        <Link
          href={href}
          className="hover:text-walnut focus-visible:ring-walnut/40 inline-flex items-center gap-1 text-sm font-medium text-ink-900 transition focus-visible:rounded-full focus-visible:ring-2 focus-visible:outline-none"
        >
          {ctaLabel}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </header>

      <div
        ref={railRef}
        className="relative -mx-6 mt-8 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <DragHint scopeRef={railRef} />
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.1 }}
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.05 } },
          }}
          className="flex snap-x snap-mandatory gap-4 pb-2 md:gap-6"
        >
          {products.map((p) => (
            <motion.li
              key={p.sku}
              variants={{
                hidden: { opacity: 0, y: 12 },
                show: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
                },
              }}
              className="w-[72vw] shrink-0 snap-start sm:w-[44vw] md:w-[300px] lg:w-[280px]"
            >
              <ProductCard product={p} className="h-full" />
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
