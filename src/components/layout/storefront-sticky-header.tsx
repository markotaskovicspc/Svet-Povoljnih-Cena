"use client";

import { useEffect, useRef, type ReactNode } from "react";

const HEADER_HEIGHT_PROPERTY = "--storefront-sticky-header-height";

/**
 * Keeps desktop sticky content below the full storefront header, including
 * the optional promo bar whose height can change after hydration.
 */
export function StorefrontStickyHeader({ children }: { children: ReactNode }) {
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const root = document.documentElement;
    const updateHeight = () => {
      root.style.setProperty(
        HEADER_HEIGHT_PROPERTY,
        `${Math.ceil(header.getBoundingClientRect().height)}px`,
      );
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    window.addEventListener("resize", updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
      root.style.removeProperty(HEADER_HEIGHT_PROPERTY);
    };
  }, []);

  return (
    <div ref={headerRef} className="sticky top-0 z-50 bg-white">
      {children}
    </div>
  );
}
