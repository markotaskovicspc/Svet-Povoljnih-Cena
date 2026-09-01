import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getEmailConfig } from "@/lib/email/config";

type RecoveryTokenPayload = {
  v: 1;
  sessionId: string;
  step: number;
  exp: number;
};

export function buildCartRecoveryToken(
  sessionId: string,
  step: number,
  expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
) {
  const payload: RecoveryTokenPayload = {
    v: 1,
    sessionId,
    step,
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", recoverySecret())
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function buildCartRecoveryUrl(sessionId: string, step: number) {
  const cfg = getEmailConfig();
  const token = buildCartRecoveryToken(sessionId, step);
  return `${cfg.baseUrl}/checkout/nastavi/${encodeURIComponent(token)}`;
}

export function verifyCartRecoveryToken(token: string) {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  let expected: string;
  try {
    expected = createHmac("sha256", recoverySecret())
      .update(body)
      .digest("base64url");
  } catch {
    return null;
  }
  if (!safeEqual(signature, expected)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Partial<RecoveryTokenPayload>;
    if (
      parsed.v !== 1 ||
      typeof parsed.sessionId !== "string" ||
      !/^[A-Za-z0-9_-]{12,80}$/.test(parsed.sessionId) ||
      !Number.isInteger(parsed.step) ||
      Number(parsed.step) < 1 ||
      Number(parsed.step) > 3 ||
      typeof parsed.exp !== "number" ||
      parsed.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return parsed as RecoveryTokenPayload;
  } catch {
    return null;
  }
}

function recoverySecret() {
  const secret =
    process.env.CART_RECOVERY_TOKEN_SECRET?.trim() ||
    getEmailConfig().unsubscribeSecret;
  if (!secret) throw new Error("CART_RECOVERY_TOKEN_SECRET is not configured");
  return secret;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
