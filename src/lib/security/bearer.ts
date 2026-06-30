import "server-only";

import { timingSafeEqual } from "node:crypto";

export function hasBearerSecret(req: Request, expected: string | null | undefined) {
  if (!expected) return false;
  const header = req.headers.get("authorization");
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return safeEqual(token, expected);
}

function safeEqual(left: string | null | undefined, right: string) {
  if (!left) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
