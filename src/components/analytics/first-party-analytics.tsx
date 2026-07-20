"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { sendGAEvent } from "@next/third-parties/google";
import { useCart } from "@/lib/hooks/use-cart";
import { useCheckout } from "@/lib/checkout/store";
import type { Order } from "@/types";
import {
  buildAddToCartPayload,
  buildBeginCheckoutPayload,
  buildPurchasePayload,
  buildViewItemPayload,
  isPurchaseReady,
  type Ga4ItemInput,
} from "@/lib/analytics/ga4-ecommerce";

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
  if (typeof window === "undefined" || !hasConsent()) return false;
  try {
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
      return true;
    }
    void fetch("/api/analytics/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    });
    return true;
  } catch {
    return false;
  }
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

export function ProductViewAnalytics({
  productId,
  item,
}: {
  productId?: string;
  item: Ga4ItemInput;
}) {
  const sent = useRef(false);

  useEffect(() => {
    const record = () => {
      if (sent.current || !hasConsent()) return;
      const payload = buildViewItemPayload(item);
      if (productId) {
        recordFirstPartyEvent({
          type: "PRODUCT_VIEW",
          productId,
          value: payload.value,
          metadata: { sku: item.sku },
        });
      }
      queueGa4Event("view_item", payload);
      sent.current = true;
    };
    record();
    const onConsent = () => window.setTimeout(record, 0);
    window.addEventListener("spc-cookie-consent", onConsent);
    return () => window.removeEventListener("spc-cookie-consent", onConsent);
  }, [item, productId]);
  return null;
}

export function CheckoutStartedAnalytics() {
  const hydrated = useCart((state) => state.hydrated);
  const lines = useCart((state) => state.lines);
  const voucher = useCheckout((state) => state.voucher);
  const sent = useRef(false);

  useEffect(() => {
    if (!hydrated || !lines.length) return;
    const record = () => {
      if (sent.current || !hasConsent()) return;
      const payload = buildBeginCheckoutPayload(
        lines.map((line) => ({
          sku: line.sku,
          name: line.name,
          unitPrice: line.unitPriceSale,
          fullUnitPrice: line.unitPriceFull,
          quantity: line.qty,
        })),
        {
          coupon: voucher?.code,
          discount: voucher?.discountRsd,
        },
      );
      recordFirstPartyEvent({
        type: "CHECKOUT_STARTED",
        value: payload.value,
        quantity: lines.reduce((sum, line) => sum + line.qty, 0),
        metadata: {
          skuCount: lines.length,
          coupon: voucher?.code ?? null,
        },
      });
      queueGa4Event("begin_checkout", payload);
      sent.current = true;
    };
    record();
    const onConsent = () => window.setTimeout(record, 0);
    window.addEventListener("spc-cookie-consent", onConsent);
    return () => window.removeEventListener("spc-cookie-consent", onConsent);
  }, [hydrated, lines, voucher]);
  return null;
}

export function recordGa4AddToCart(item: Ga4ItemInput) {
  if (typeof window === "undefined" || !hasConsent()) return false;
  return queueGa4Event("add_to_cart", buildAddToCartPayload(item));
}

export function PurchaseAnalytics({
  order,
  paymentStatus,
}: {
  order: Order;
  paymentStatus?: string;
}) {
  const sent = useRef(false);

  useEffect(() => {
    if (!isPurchaseReady(order, paymentStatus)) return;
    const record = () => {
      if (sent.current || !hasConsent()) return;
      sent.current = recordGa4Purchase(order);
    };
    record();
    const onConsent = () => window.setTimeout(record, 0);
    window.addEventListener("spc-cookie-consent", onConsent);
    return () => window.removeEventListener("spc-cookie-consent", onConsent);
  }, [order, paymentStatus]);

  return null;
}

type Ga4EventName =
  | "view_item"
  | "add_to_cart"
  | "begin_checkout"
  | "purchase";

const pendingPurchases = new Set<string>();
const PURCHASE_STORAGE_PREFIX = "spc_ga4_purchase:";

function recordGa4Purchase(order: Order) {
  const storageKey = `${PURCHASE_STORAGE_PREFIX}${order.id}`;
  if (hasRecordedPurchase(storageKey) || pendingPurchases.has(order.id)) {
    return true;
  }
  pendingPurchases.add(order.id);
  const queued = queueGa4Event("purchase", buildPurchasePayload(order), {
    onSent: () => {
      rememberPurchase(storageKey);
      pendingPurchases.delete(order.id);
    },
    onFailed: () => pendingPurchases.delete(order.id),
  });
  if (!queued) pendingPurchases.delete(order.id);
  return queued;
}

function hasRecordedPurchase(storageKey: string) {
  try {
    return Boolean(window.localStorage.getItem(storageKey));
  } catch {
    return false;
  }
}

function rememberPurchase(storageKey: string) {
  try {
    window.localStorage.setItem(storageKey, new Date().toISOString());
  } catch {
    // GA4 also deduplicates purchase events by transaction_id.
  }
}

function queueGa4Event(
  name: Ga4EventName,
  params: Record<string, unknown>,
  callbacks?: { onSent?: () => void; onFailed?: () => void },
) {
  if (typeof window === "undefined" || !hasConsent()) return false;
  let attempts = 0;
  const send = () => {
    const dataLayer = (window as Window & { dataLayer?: unknown[] }).dataLayer;
    if (
      Array.isArray(dataLayer) &&
      document.getElementById("_next-ga-init")
    ) {
      sendGAEvent("event", name, params);
      callbacks?.onSent?.();
      return;
    }
    attempts += 1;
    if (attempts < 20) {
      window.setTimeout(send, 100);
    } else {
      callbacks?.onFailed?.();
    }
  };
  send();
  return true;
}
