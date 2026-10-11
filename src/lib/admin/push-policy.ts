import { z } from "zod";

export function canReceiveOrderPush(role: string | null | undefined) {
  return role === "SUPER" || role === "OPS";
}

// Browser subscriptions are untrusted URLs: never let the sender reach arbitrary hosts.
export function isPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      (!url.port || url.port === "443") && (
        url.hostname === "fcm.googleapis.com" ||
        url.hostname === "updates.push.services.mozilla.com" ||
        url.hostname === "web.push.apple.com" ||
        url.hostname.endsWith(".notify.windows.com")
      );
  } catch { return false; }
}

export const pushEndpointSchema = z.string().max(2048).refine(isPushEndpoint);
export const pushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}={0,2}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}={0,2}$/),
  }),
});
