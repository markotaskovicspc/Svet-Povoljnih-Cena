"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { allowsAnalytics, trackingConsentFromCookieHeader } from "@/lib/analytics/tracking-consent";
import { normalizeAffiliateCode } from "@/lib/affiliate/shared";
export function AffiliateTracker() {
  const pathname = usePathname();
  useEffect(() => {
    let pending = false;
    const sync = async () => {
      if (pending) return;
      const code = normalizeAffiliateCode(new URLSearchParams(window.location.search).get("ref"));
      const consent = allowsAnalytics(trackingConsentFromCookieHeader(document.cookie));
      if (consent && !code) return;
      pending = true;
      try {
        const response = await fetch("/api/affiliate/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), credentials: "same-origin" });
        if (response.ok && consent && code) {
          const url = new URL(window.location.href);
          url.searchParams.delete("ref");
          window.history.replaceState(window.history.state, "", url);
        }
      } catch { /* Attribution must never block shopping. */ }
      finally { pending = false; }
    };
    void sync();
    window.addEventListener("spc-cookie-consent", sync);
    return () => window.removeEventListener("spc-cookie-consent", sync);
  }, [pathname]);
  return null;
}
