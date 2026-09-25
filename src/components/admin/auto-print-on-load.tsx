"use client";

import { useEffect } from "react";

export function AutoPrintOnLoad() {
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let timer = 0;
    const preparePrint = async () => {
      if (document.fonts) await document.fonts.ready;
      if (cancelled) return;
      // Leave the load event and allow layout/paint before Safari opens print UI.
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          timer = window.setTimeout(() => {
            if (!cancelled) window.print();
          }, 250);
        });
      });
    };
    if (document.readyState === "complete") void preparePrint();
    else window.addEventListener("load", preparePrint, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", preparePrint);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
