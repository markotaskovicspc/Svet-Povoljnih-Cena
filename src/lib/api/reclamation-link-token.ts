import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const RECLAMATION_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function secret() {
  const value = [process.env.ORDER_ACCESS_TOKEN_SECRET, process.env.AUTH_SECRET, process.env.NEXTAUTH_SECRET]
    .map(value => value?.trim()).find(value => value && !value.startsWith("GET_FROM_"));
  if (!value) throw new Error("Tajna za zaštićene linkove nije podešena.");
  return value;
}
function signature(body: string) {
  return createHmac("sha256", secret()).update(`reclamation-only:${body}`).digest("base64url");
}
export function createReclamationLinkToken(orderNumber: string, now = Date.now()) {
  const expiresAt = now + RECLAMATION_LINK_TTL_MS;
  const body = Buffer.from(JSON.stringify({ order: orderNumber, expiresAt, nonce: randomBytes(16).toString("base64url") })).toString("base64url");
  return { token: `rcl1.${body}.${signature(body)}`, expiresAt };
}
export function verifyReclamationLinkToken(token: string | null | undefined, orderNumber: string, now = Date.now()) {
  if (!token || token.length > 1000) return false;
  try {
    const [prefix, body, sig, extra] = token.split(".");
    if (prefix !== "rcl1" || !body || !sig || extra !== undefined) return false;
    const actual = Buffer.from(sig); const expected = Buffer.from(signature(body));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return data.order === orderNumber && Number.isSafeInteger(data.expiresAt) && data.expiresAt > now && data.expiresAt <= now + RECLAMATION_LINK_TTL_MS;
  } catch { return false; }
}
