import "server-only";

import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { envValue } from "@/lib/env";
import { createCheckoutOrderAccessToken, hashOrderAccessToken, verifyOrderAccessToken } from "@/lib/api/order-access";
import type { Order } from "@/types";

/** Reuse the buyer's existing access; never rotate a link from an earlier email. */
export async function orderLinkForEmail(
  orderId: string,
  order: Pick<Order, "id" | "userId">,
  baseUrl: string,
): Promise<string | null> {
  const base = baseUrl.replace(/\/+$/, "");
  if (order.userId) return `${base}/nalog/porudzbine/${encodeURIComponent(order.id)}`;
  const current = await db.order.findUnique({
    where: { id: orderId },
    select: { userId: true, publicAccessTokenHash: true,
      checkoutSessions: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 5 } },
  });
  if (!current || current.userId) return null;
  const secret = envValue("ORDER_ACCESS_TOKEN_SECRET") ?? envValue("AUTH_SECRET") ?? envValue("NEXTAUTH_SECRET");
  if (!secret) return null;
  const emailToken = createHmac("sha256", secret).update("order-email-access:").update(orderId).digest("base64url");
  const link = (token: string) => `${base}/checkout/potvrda?order=${encodeURIComponent(order.id)}&token=${encodeURIComponent(token)}`;
  if (current.publicAccessTokenHash) {
    const candidates = [emailToken, ...current.checkoutSessions.map(session => createCheckoutOrderAccessToken(session.id))];
    const existing = candidates.find(token => verifyOrderAccessToken({ token, tokenHash: current.publicAccessTokenHash }));
    return existing ? link(existing) : null;
  }
  // Manual guest orders have no checkout token. Initialize only an empty hash;
  // a concurrent token issuance must keep its existing access unchanged.
  const saved = await db.order.updateMany({
    where: { id: orderId, userId: null, publicAccessTokenHash: null },
    data: { publicAccessTokenHash: hashOrderAccessToken(emailToken), publicAccessTokenCreatedAt: new Date() },
  });
  if (saved.count === 1) return link(emailToken);
  const raced = await db.order.findUnique({ where: { id: orderId }, select: { userId: true, publicAccessTokenHash: true } });
  return raced && !raced.userId && verifyOrderAccessToken({ token: emailToken, tokenHash: raced.publicAccessTokenHash })
    ? link(emailToken) : null;
}
