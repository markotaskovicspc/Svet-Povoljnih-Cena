"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const CONSENT_COOKIE = "spc_cookie_consent=analytics";
const CONSENT_VERSION = "2026-07";

function hasConsent() {
  return document.cookie.split(";").some((part) => part.trim() === CONSENT_COOKIE);
}

function rotatingAnonymousId() {
  const month = new Date().toISOString().slice(0, 7);
  const key = `spc_analytics_id:${month}`;
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(key, id);
  }
  for (const existingKey of Object.keys(window.localStorage)) {
    if (existingKey.startsWith("spc_analytics_id:") && existingKey !== key) {
      window.localStorage.removeItem(existingKey);
    }
  }
  return `${month}:${id}`;
}

function sessionId() {
  const key = "spc_analytics_session";
  let id = window.sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    window.sessionStorage.setItem(key, id);
  }
  return id;
}

export function recordFirstPartyEvent(input: {
  type: "PAGE_VIEW" | "PRODUCT_VIEW" | "ADD_TO_CART" | "CHECKOUT_STARTED";
  path?: string;
  productId?: string;
  quantity?: number;
  value?: number;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  if (typeof window === "undefined" || !hasConsent()) return;
  const payload = JSON.stringify({
    ...input,
    path: input.path ?? `${window.location.pathname}${window.location.search}`,
    anonymousId: rotatingAnonymousId(),
    sessionId: sessionId(),
    consentVersion: CONSENT_VERSION,
  });
  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      "/api/analytics/events",
      new Blob([payload], { type: "application/json" }),
    );
    return;
  }
  void fetch("/api/analytics/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    keepalive: true,
  });
}

export function FirstPartyAnalytics() {
  const pathname = usePathname();
  useEffect(() => {
    recordFirstPartyEvent({ type: "PAGE_VIEW", path: pathname });
    const onConsent = () =>
      recordFirstPartyEvent({ type: "PAGE_VIEW", path: pathname });
    window.addEventListener("spc-cookie-consent", onConsent);
    return () => window.removeEventListener("spc-cookie-consent", onConsent);
  }, [pathname]);
  return null;
}

export function ProductViewAnalytics({ productId }: { productId?: string }) {
  useEffect(() => {
    if (productId) recordFirstPartyEvent({ type: "PRODUCT_VIEW", productId });
  }, [productId]);
  return null;
}

export function CheckoutStartedAnalytics() {
  useEffect(() => {
    recordFirstPartyEvent({ type: "CHECKOUT_STARTED" });
  }, []);
  return null;
}
