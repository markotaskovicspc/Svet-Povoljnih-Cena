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
import {
  buildMetaAddToCartPayload,
  buildMetaInitiateCheckoutPayload,
  buildMetaPurchasePayload,
  buildMetaViewContentPayload,
  metaPurchaseEventId,
} from "@/lib/analytics/meta-ecommerce";
import { recordMetaEvent } from "@/lib/analytics/meta-client";
import {
  allowsAnalytics,
  trackingConsentFromCookieHeader,
} from "@/lib/analytics/tracking-consent";

const CONSENT_VERSION = "2026-08";
const ANALYTICS_IDENTITY_KEY = "spc_analytics_identity";
const ANALYTICS_ID_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

function hasAnalyticsConsent() {
  return allowsAnalytics(trackingConsentFromCookieHeader(document.cookie));
}

function rotatingAnonymousId() {
  const now = Date.now();
  let identity: { id: string; createdAt: number } | null = null;
  try {
    const raw = window.localStorage.getItem(ANALYTICS_IDENTITY_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    if (
      parsed &&
      typeof parsed.id === "string" &&
      typeof parsed.createdAt === "number" &&
      parsed.createdAt <= now &&
      now - parsed.createdAt < ANALYTICS_ID_MAX_AGE_MS
    ) {
      identity = { id: parsed.id, createdAt: parsed.createdAt };
    }
  } catch {
    identity = null;
  }
  if (!identity) {
    identity = { id: crypto.randomUUID(), createdAt: now };
    window.localStorage.setItem(ANALYTICS_IDENTITY_KEY, JSON.stringify(identity));
  }
  for (const existingKey of Object.keys(window.localStorage)) {
    if (existingKey.startsWith("spc_analytics_id:")) {
      window.localStorage.removeItem(existingKey);
    }
  }
  return `v2:${identity.id}`;
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

export type ConsentedAnalyticsContext = {
  anonymousId: string;
  sessionId: string;
  consentVersion: string;
  path: string;
};

export function getConsentedAnalyticsContext(): ConsentedAnalyticsContext | undefined {
  if (typeof window === "undefined" || !hasAnalyticsConsent()) return undefined;
  try {
    return {
      anonymousId: rotatingAnonymousId(),
      sessionId: sessionId(),
      consentVersion: CONSENT_VERSION,
      path: `${window.location.pathname}${window.location.search}`,
    };
  } catch {
    return undefined;
  }
}

export function recordFirstPartyEvent(input: {
  type: "PAGE_VIEW" | "PRODUCT_VIEW" | "ADD_TO_CART" | "CHECKOUT_STARTED";
  path?: string;
  productId?: string;
  quantity?: number;
  value?: number;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  if (typeof window === "undefined" || !hasAnalyticsConsent()) return false;
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
  const analyticsSent = useRef(false);
  const metaSent = useRef(false);

  useEffect(() => {
    const record = () => {
      const payload = buildViewItemPayload(item);
      if (!analyticsSent.current && hasAnalyticsConsent()) {
        if (productId) {
          recordFirstPartyEvent({
            type: "PRODUCT_VIEW",
            productId,
            value: payload.value,
            metadata: { sku: item.sku },
          });
        }
        queueGa4Event("view_item", payload);
        analyticsSent.current = true;
      }
      if (!metaSent.current) {
        metaSent.current = recordMetaEvent({
          name: "ViewContent",
          customData: buildMetaViewContentPayload(item),
        });
      }
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
  const analyticsSent = useRef(false);
  const metaSent = useRef(false);

  useEffect(() => {
    if (!hydrated || !lines.length) return;
    const record = () => {
      const items = lines.map((line) => ({
        sku: line.sku,
        name: line.name,
        unitPrice: line.unitPriceSale,
        fullUnitPrice: line.unitPriceFull,
        quantity: line.qty,
        variant: line.variant,
        familyCode: line.familyCode,
      }));
      const options = {
        coupon: voucher?.code,
        discount: voucher?.discountRsd,
      };
      if (!analyticsSent.current && hasAnalyticsConsent()) {
        const payload = buildBeginCheckoutPayload(items, options);
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
        analyticsSent.current = true;
      }
      if (!metaSent.current) {
        metaSent.current = recordMetaEvent({
          name: "InitiateCheckout",
          customData: buildMetaInitiateCheckoutPayload(items, options),
        });
      }
    };
    record();
    const onConsent = () => window.setTimeout(record, 0);
    window.addEventListener("spc-cookie-consent", onConsent);
    return () => window.removeEventListener("spc-cookie-consent", onConsent);
  }, [hydrated, lines, voucher]);
  return null;
}

export function recordCommerceAddToCart(item: Ga4ItemInput) {
  if (typeof window === "undefined") return false;
  const gaQueued = hasAnalyticsConsent()
    ? queueGa4Event("add_to_cart", buildAddToCartPayload(item))
    : false;
  const metaQueued = recordMetaEvent({
    name: "AddToCart",
    customData: buildMetaAddToCartPayload(item),
  });
  return gaQueued || metaQueued;
}

export function PurchaseAnalytics({
  order,
  accessToken,
  paymentStatus,
}: {
  order: Order;
  accessToken?: string;
  paymentStatus?: string;
}) {
  const gaSent = useRef(false);
  const metaSent = useRef(false);

  useEffect(() => {
    if (!isPurchaseReady(order, paymentStatus)) return;
    const record = () => {
      if (!gaSent.current && hasAnalyticsConsent()) {
        gaSent.current = recordGa4Purchase(order);
      }
      if (!metaSent.current) {
        metaSent.current = recordMetaPurchase(order, accessToken);
      }
    };
    record();
    const onConsent = () => window.setTimeout(record, 0);
    window.addEventListener("spc-cookie-consent", onConsent);
    return () => window.removeEventListener("spc-cookie-consent", onConsent);
  }, [accessToken, order, paymentStatus]);

  return null;
}

type Ga4EventName =
  | "view_item"
  | "add_to_cart"
  | "begin_checkout"
  | "purchase";

const pendingPurchases = new Set<string>();
const PURCHASE_STORAGE_PREFIX = "spc_ga4_purchase:";
const META_PURCHASE_STORAGE_PREFIX = "spc_meta_purchase:";

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

function recordMetaPurchase(order: Order, accessToken?: string) {
  const storageKey = `${META_PURCHASE_STORAGE_PREFIX}${order.id}`;
  if (hasRecordedPurchase(storageKey)) return true;
  const queued = recordMetaEvent({
    name: "Purchase",
    customData: buildMetaPurchasePayload(order),
    eventId: metaPurchaseEventId(order.id),
    orderNumber: order.id,
    orderAccessToken: accessToken,
  });
  if (queued) rememberPurchase(storageKey);
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
  if (typeof window === "undefined" || !hasAnalyticsConsent()) return false;
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
