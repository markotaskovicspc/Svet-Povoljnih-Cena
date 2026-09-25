import { createHmac, timingSafeEqual } from "node:crypto";

export function constantEqual(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function verifySocialRequest(body: string, timestamp: string, signature: string, secret: string, now = Date.now()) {
  if (secret.length < 32 || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 60_000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return constantEqual(expected, signature);
}
export function signSocialQuote(payload: object, secret: string) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${createHmac("sha256", secret).update(`quote:${data}`).digest("base64url")}`;
}
export function readSocialQuote(token: string, secret: string): unknown {
  const [data, signature, extra] = token.split(".");
  if (!data || !signature || extra || secret.length < 32) throw new Error("INVALID_QUOTE");
  const expected = createHmac("sha256", secret).update(`quote:${data}`).digest("base64url");
  if (!constantEqual(signature, expected)) throw new Error("INVALID_QUOTE");
  return JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
}
