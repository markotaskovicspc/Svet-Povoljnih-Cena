import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

type RateLimitConfig = {
  limit: number;
  windowMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const RATE_LIMITS = {
  adminLogin: { limit: 5, windowMs: 15 * MINUTE },
  login: { limit: 10, windowMs: 15 * MINUTE },
  passwordReset: { limit: 5, windowMs: HOUR },
  checkout: { limit: 60, windowMs: MINUTE },
  checkoutOrder: { limit: 10, windowMs: 10 * MINUTE },
  ipsCallback: { limit: 60, windowMs: MINUTE },
  ipsCallbackOrder: { limit: 6, windowMs: 10 * MINUTE },
  voucher: { limit: 20, windowMs: 10 * MINUTE },
  newsletter: { limit: 10, windowMs: HOUR },
  search: { limit: 120, windowMs: MINUTE },
  upload: { limit: 10, windowMs: HOUR },
  reclamation: { limit: 10, windowMs: HOUR },
} satisfies Record<string, RateLimitConfig>;

const globalForRateLimit = globalThis as unknown as {
  spcRateLimitBuckets?: Map<string, Bucket>;
  spcRateLimitLastSweep?: number;
};

const buckets =
  globalForRateLimit.spcRateLimitBuckets ??
  (globalForRateLimit.spcRateLimitBuckets = new Map<string, Bucket>());

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  now = Date.now(),
): RateLimitResult {
  sweepExpiredBuckets(now);
  const current = buckets.get(key);
  const bucket =
    current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + config.windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return {
    ok: bucket.count <= config.limit,
    limit: config.limit,
    remaining: Math.max(0, config.limit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSec,
  };
}

export function checkRateLimitForRequest(
  req: Request,
  scope: string,
  config: RateLimitConfig,
  extraParts: Array<string | number | null | undefined> = [],
) {
  return checkRateLimit(
    rateLimitKey(scope, getClientIp(req), ...extraParts),
    config,
  );
}

export function rateLimitKey(
  scope: string,
  ...parts: Array<string | number | null | undefined>
) {
  const normalized = parts
    .map((part) => String(part ?? "").trim().toLowerCase())
    .join("|");
  const digest = createHash("sha256").update(normalized).digest("base64url");
  return `${scope}:${digest}`;
}

export function getClientIp(req: Request) {
  return getClientIpFromHeaders(req.headers);
}

export function getClientIpFromHeaders(headers: Pick<Headers, "get">) {
  const forwarded =
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0];
  return forwarded?.trim() || "unknown";
}

export function rateLimitJson(
  result: RateLimitResult,
  message = "Previše zahteva. Pokušajte ponovo kasnije.",
) {
  return NextResponse.json(
    { ok: false, error: "rate_limited", message },
    {
      status: 429,
      headers: rateLimitHeaders(result),
    },
  );
}

function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    "Retry-After": String(result.retryAfterSec),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}

function sweepExpiredBuckets(now: number) {
  const lastSweep = globalForRateLimit.spcRateLimitLastSweep ?? 0;
  if (now - lastSweep < MINUTE) return;
  globalForRateLimit.spcRateLimitLastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
