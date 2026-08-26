"use client";

import {
  allowsMarketing,
  trackingConsentFromCookieHeader,
} from "@/lib/analytics/tracking-consent";
import {
  getMetaPixelId,
  type MetaCustomData,
  type MetaStandardEventName,
} from "@/lib/analytics/meta-ecommerce";

type MetaPixelFunction = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  loaded: boolean;
  version: string;
  push: MetaPixelFunction;
};

declare global {
  interface Window {
    fbq?: MetaPixelFunction;
    _fbq?: MetaPixelFunction;
    __spcMetaPixelIds?: Set<string>;
  }
}

export type MetaClientEvent = {
  name: MetaStandardEventName;
  customData?: MetaCustomData;
  eventId?: string;
  orderNumber?: string;
  orderAccessToken?: string;
};

const configuredPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;

export function recordMetaEvent(input: MetaClientEvent) {
  if (typeof window === "undefined" || !hasMarketingConsent()) return false;
  const pixelId = getMetaPixelId(configuredPixelId);
  if (!pixelId) return false;

  const fbq = ensureMetaPixelQueue(pixelId);
  const eventId = input.eventId ?? createEventId(input.name);
  fbq("track", input.name, input.customData ?? {}, { eventID: eventId });
  sendServerEvent({ ...input, eventId });
  return true;
}

export function revokeMetaConsent() {
  if (typeof window === "undefined") return;
  window.fbq?.("consent", "revoke");
  expireMetaCookie("_fbp");
  expireMetaCookie("_fbc");
}

function hasMarketingConsent() {
  return allowsMarketing(trackingConsentFromCookieHeader(document.cookie));
}

function ensureMetaPixelQueue(pixelId: string) {
  let fbq = window.fbq;
  if (!fbq) {
    const queue = function (...args: unknown[]) {
      if (queue.callMethod) queue.callMethod(...args);
      else queue.queue.push(args);
    } as MetaPixelFunction;
    queue.queue = [];
    queue.loaded = true;
    queue.version = "2.0";
    queue.push = queue;
    window.fbq = queue;
    window._fbq = queue;
    fbq = queue;
  }

  window.__spcMetaPixelIds ??= new Set<string>();
  if (!window.__spcMetaPixelIds.has(pixelId)) {
    fbq("consent", "grant");
    fbq("init", pixelId);
    window.__spcMetaPixelIds.add(pixelId);
  }
  return fbq;
}

function sendServerEvent(input: MetaClientEvent & { eventId: string }) {
  const body = JSON.stringify({
    eventName: input.name,
    eventId: input.eventId,
    path: window.location.pathname,
    customData: input.customData,
    orderNumber: input.orderNumber,
    orderAccessToken: input.orderAccessToken,
  });
  void fetch("/api/analytics/meta/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // The browser Pixel remains useful when the optional server channel is down.
  });
}

function createEventId(name: MetaStandardEventName) {
  const random =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${name.toLowerCase()}:${random}`;
}

function expireMetaCookie(name: string) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const base = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  document.cookie = base;
  if (!window.location.hostname.includes("localhost")) {
    document.cookie = `${base}; Domain=.${window.location.hostname.replace(/^www\./, "")}`;
  }
}
