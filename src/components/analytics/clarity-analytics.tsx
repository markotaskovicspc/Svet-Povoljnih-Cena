"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { createClarityController } from "@/lib/analytics/clarity-client";
import { trackingConsentFromCookieHeader } from "@/lib/analytics/tracking-consent";

export function ClarityAnalytics() {
  const pathname = usePathname();
  const controller = useRef<ReturnType<typeof createClarityController> | null>(null);
  useEffect(() => {
    controller.current ??= createClarityController(window);
    const sync = () => controller.current?.sync(
      trackingConsentFromCookieHeader(document.cookie), window.location.pathname, window.location.search,
    );
    sync();
    window.addEventListener("spc-cookie-consent", sync);
    return () => {
      window.removeEventListener("spc-cookie-consent", sync);
      controller.current?.stop();
    };
  }, []);
  useEffect(() => {
    controller.current?.sync(trackingConsentFromCookieHeader(document.cookie), pathname, window.location.search);
  }, [pathname]);
  return null;
}
