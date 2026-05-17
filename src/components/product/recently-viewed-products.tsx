"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Product } from "@/types";
import { ProductCard } from "@/components/product/product-card";

const STORAGE_KEY = "svet-akcija-recent-products";
const STORAGE_EVENT = "svet-akcija-recent-products-change";
const MAX_ITEMS = 8;

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(STORAGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(STORAGE_EVENT, onStoreChange);
  };
}

function getSnapshot(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

export function RecentlyViewedProducts({ product }: { product: Product }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => "[]");
  const items = useMemo(() => {
    try {
      return JSON.parse(snapshot) as Product[];
    } catch {
      return [];
    }
  }, [snapshot]);

  useEffect(() => {
    const previous = items;

    const filtered = previous.filter((item) => item.sku !== product.sku);

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([product, ...filtered].slice(0, MAX_ITEMS)),
      );
      window.dispatchEvent(new Event(STORAGE_EVENT));
    } catch {
      // Local storage may be unavailable in private browsing.
    }
  }, [items, product]);

  const visible = useMemo(
    () => items.filter((item) => item.sku !== product.sku).slice(0, 6),
    [items, product.sku],
  );
  if (!visible.length) return null;

  return (
    <section className="mx-auto mt-8 w-full max-w-[var(--container-page)] px-6 md:mt-16">
      <h2 className="font-display text-2xl text-ink-900 md:text-3xl">
        Nedavno pregledani artikli
      </h2>
      <div className="-mx-6 mt-5 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ul className="flex snap-x snap-mandatory gap-3 pb-2 md:gap-6">
          {visible.map((item) => (
            <li
              key={item.sku}
              className="w-[46vw] shrink-0 snap-start sm:w-[34vw] md:w-[300px] lg:w-[280px]"
            >
              <ProductCard product={item} className="h-full" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
