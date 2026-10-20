import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ViberConfig } from "./config";
import type { ViberMessage, ViberDispatchResult } from "./transport";

// Official contract: https://developers.nth.ch/#operation/sendMessage
export function nthPhoneNumber(value: string) {
  let number = value.replace(/[\s()-]/g, "");
  if (number.startsWith("+")) number = number.slice(1);
  else if (number.startsWith("00")) number = number.slice(2);
  else if (number.startsWith("0")) number = `381${number.slice(1)}`;
  if (!/^381[1-9]\d{7,8}$/.test(number)) throw new Error("nth:invalid_serbian_phone");
  return number;
}

const messageSchema = z.object({
  to: z.string().min(1),
  text: z.string().max(1000),
  kind: z.enum(["promotion", "transaction"]).default("promotion"),
  imageUrl: z.url().max(1000).nullish(),
  cta: z.object({ label: z.string().min(1).max(30), url: z.url().max(1000) }).nullish(),
  template: z.object({ id: z.string().min(1), lang: z.string().min(1), parameters: z.record(z.string(), z.string()).optional() }).optional(),
  requestId: z.string().min(1).max(300).optional(),
  trackingData: z.string().max(300).optional(),
}).superRefine((m, ctx) => {
  if (!m.text && !m.template) ctx.addIssue({ code: "custom", message: "text_or_template_required" });
  if (m.kind === "transaction" && (m.imageUrl || m.cta)) ctx.addIssue({ code: "custom", message: "transaction_must_not_have_promotional_media" });
  if (m.imageUrl && !m.cta) ctx.addIssue({ code: "custom", message: "text_image_requires_button" });
  if (m.template && (m.kind !== "transaction" || m.imageUrl || m.cta)) ctx.addIssue({ code: "custom", message: "template_must_be_transaction" });
});

export function buildNthPayload(input: ViberMessage, sender: string) {
  const m = messageSchema.parse(input);
  return {
    channels: ["VIBER"],
    destinations: [{ phoneNumber: nthPhoneNumber(m.to) }],
    requestId: m.requestId ?? randomUUID(),
    ...(m.trackingData ? { transactionId: m.trackingData } : {}),
    // Reports remain available in Omni reporting/status API. Callback delivery
    // requires separately verified provider authentication; do not expose an
    // unauthenticated endpoint or put secrets in dlrUrl.
    dlr: false,
    viber: {
      sender, ttl: 3600, label: m.kind,
      ...(m.template ? { template: m.template } : { text: m.text }),
      ...(m.imageUrl ? { image: m.imageUrl } : {}),
      ...(m.cta ? { buttonCaption: m.cta.label, buttonAction: m.cta.url } : {}),
    },
  };
}

const responseSchema = z.object({
  resultCode: z.enum(["OK", "PARTIAL_OK"]),
  messages: z.array(z.object({
    messageId: z.uuid(),
    destination: z.object({ phoneNumber: z.string() }),
    status: z.object({ code: z.string() }),
  })).length(1),
});

export async function dispatchNth(msg: ViberMessage, cfg: ViberConfig): Promise<ViberDispatchResult> {
  const failed = (error: string): ViberDispatchResult => ({ ok: false, error, provider: "nth" });
  if (!cfg.username || !cfg.password) return failed("nth:missing_credentials");
  let body: ReturnType<typeof buildNthPayload>;
  try { body = buildNthPayload(msg, cfg.sender); }
  catch { return failed("nth:invalid_message"); }
  let endpoint: URL;
  try {
    endpoint = new URL(cfg.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return failed("nth:invalid_endpoint");
  } catch { return failed("nth:invalid_endpoint"); }
  try {
    const res = await fetch(endpoint, {
      method: "POST", redirect: "error", cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return failed(`nth:http_${res.status}`);
    const parsed = responseSchema.safeParse(await res.json());
    if (!parsed.success) return failed("nth:ambiguous_response_do_not_retry");
    const message = parsed.data.messages[0];
    if (message.destination.phoneNumber !== body.destinations[0].phoneNumber) return failed("nth:ambiguous_response_do_not_retry");
    if (message.status.code !== "ACCEPTED") return failed("nth:message_rejected");
    return { ok: true, messageToken: message.messageId, provider: "nth" };
  } catch {
    // A timeout can occur after the provider accepted the write. Reconcile in
    // Reporting before resending; no automatic retry or SMS fallback.
    return failed("nth:ambiguous_network_result_do_not_retry");
  }
}
