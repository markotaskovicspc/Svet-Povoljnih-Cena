import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type RateLimitConfig = {
  limit: number;
  windowMs: number;
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
  registration: { limit: 5, windowMs: HOUR },
  comments: { limit: 5, windowMs: HOUR },
  accountMutation: { limit: 20, windowMs: HOUR },
} satisfies Record<string, RateLimitConfig>;

export async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  now = Date.now(),
): Promise<RateLimitResult> {
  const currentTime = new Date(now);
  const nextReset = new Date(now + config.windowMs);
  const rows = await db.$queryRaw<Array<{ count: number; resetAt: Date }>>(
    Prisma.sql`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "updatedAt")
      VALUES (${key}, 1, ${nextReset}, ${currentTime})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitBucket"."resetAt" <= ${currentTime} THEN 1
          ELSE "RateLimitBucket"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "RateLimitBucket"."resetAt" <= ${currentTime} THEN ${nextReset}
          ELSE "RateLimitBucket"."resetAt"
        END,
        "updatedAt" = ${currentTime}
      RETURNING "count", "resetAt"
    `,
  );
  const bucket = rows[0];
  if (!bucket) throw new Error("Rate-limit state was not persisted.");

  const retryAfterSec = Math.max(
    1,
    Math.ceil((bucket.resetAt.getTime() - now) / 1000),
  );
  return {
    ok: bucket.count <= config.limit,
    limit: config.limit,
    remaining: Math.max(0, config.limit - bucket.count),
    resetAt: bucket.resetAt.getTime(),
    retryAfterSec,
  };
}

export async function checkRateLimitForRequest(
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

export async function deleteExpiredRateLimitBuckets(now = new Date()) {
  return db.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } });
}
