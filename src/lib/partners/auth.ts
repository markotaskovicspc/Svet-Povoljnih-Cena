import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { PartnerApiClient } from "@prisma/client";
import { db } from "@/lib/db";
import {
  checkRateLimit,
  rateLimitKey,
  type RateLimitResult,
} from "@/lib/security/rate-limit";

type PartnerAuthResult =
  | { ok: true; client: PartnerApiClient; rateLimit: RateLimitResult }
  | { ok: false; status: 401 | 403 | 429; error: string; rateLimit?: RateLimitResult };

function safeHashEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export async function authenticatePartner(
  request: Request,
  requiredScope: "inventory:read" | "reservations:write",
): Promise<PartnerAuthResult> {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Bearer ključ je obavezan." };
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (token.length < 24) {
    return { ok: false, status: 401, error: "Bearer ključ nije važeći." };
  }
  const keyPrefix = token.slice(0, 18);
  const client = await db.partnerApiClient.findUnique({ where: { keyPrefix } });
  const presentedHash = createHash("sha256").update(token).digest("hex");
  if (!client || !client.enabled || !safeHashEqual(presentedHash, client.keyHash)) {
    return { ok: false, status: 401, error: "Bearer ključ nije važeći ili je opozvan." };
  }
  if (!client.scopes.includes(requiredScope)) {
    return {
      ok: false,
      status: 403,
      error: `Ključ nema scope ${requiredScope}.`,
    };
  }
  const rateLimit = await checkRateLimit(
    rateLimitKey("partner-api", client.id),
    { limit: client.rateLimit, windowMs: 60_000 },
  );
  if (!rateLimit.ok) {
    return {
      ok: false,
      status: 429,
      error: "Prekoračen je partner API rate limit.",
      rateLimit,
    };
  }
  await db.partnerApiClient.update({
    where: { id: client.id },
    data: { lastUsedAt: new Date() },
  });
  return { ok: true, client, rateLimit };
}

export function partnerRateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    ...(result.ok ? {} : { "Retry-After": String(result.retryAfterSec) }),
  };
}
