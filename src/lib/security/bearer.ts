import "server-only";

import { timingSafeEqual } from "node:crypto";

export function hasBearerSecret(req: Request, expected: string | null | undefined) {
  if (!expected) return false;
  const header = req.headers.get("authorization");
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return safeEqual(token, expected);
}

/**
 * Authorizes a cron request against EITHER its dedicated secret OR the
 * global `CRON_SECRET`. Vercel Cron always sends `Authorization: Bearer
 * <CRON_SECRET>` automatically when that env var is set on the project, so
 * every cron route must accept it in addition to its own dedicated secret —
 * otherwise Vercel's built-in invocation gets rejected. Same trust level
 * either way (both are server-only secrets); this only widens which secret
 * is accepted, it never weakens the check.
 */
export function isAuthorizedCronRequest(
  req: Request,
  dedicatedSecret: string | null | undefined,
) {
  if (hasBearerSecret(req, dedicatedSecret)) return true;
  return hasBearerSecret(req, process.env.CRON_SECRET);
}

function safeEqual(left: string | null | undefined, right: string) {
  if (!left) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
