import "server-only";

import { createVerify } from "node:crypto";

export type SnsEnvelope = {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
};

const certificateCache = new Map<string, { pem: string; expiresAt: number }>();

export async function verifySnsEnvelope(
  envelope: SnsEnvelope,
  expectedTopicArn: string,
) {
  if (!expectedTopicArn || envelope.TopicArn !== expectedTopicArn) return false;
  if (!isTrustedSnsUrl(envelope.SigningCertURL, true)) return false;
  if (envelope.SignatureVersion !== "1" && envelope.SignatureVersion !== "2") {
    return false;
  }
  const pem = await loadCertificate(envelope.SigningCertURL);
  const verifier = createVerify(
    envelope.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1",
  );
  verifier.update(snsStringToSign(envelope), "utf8");
  verifier.end();
  return verifier.verify(pem, envelope.Signature, "base64");
}

export function snsStringToSign(envelope: SnsEnvelope) {
  const fields =
    envelope.Type === "Notification"
      ? (["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"] as const)
      : ([
          "Message",
          "MessageId",
          "SubscribeURL",
          "Timestamp",
          "Token",
          "TopicArn",
          "Type",
        ] as const);
  let value = "";
  for (const field of fields) {
    const fieldValue = envelope[field];
    if (fieldValue == null) continue;
    value += `${field}\n${fieldValue}\n`;
  }
  return value;
}

export function isTrustedSnsUrl(value: string, certificate = false) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !/^sns(?:\.[a-z0-9-]+)?\.amazonaws\.com(?:\.cn)?$/i.test(url.hostname)
    ) {
      return false;
    }
    if (certificate) {
      return /^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(
        url.pathname,
      );
    }
    return (
      url.pathname === "/" &&
      url.searchParams.get("Action") === "ConfirmSubscription"
    );
  } catch {
    return false;
  }
}

export function mapSesEventType(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  const types: Record<string, string> = {
    send: "email.sent",
    delivery: "email.delivered",
    open: "email.opened",
    click: "email.clicked",
    bounce: "email.bounced",
    complaint: "email.complained",
    reject: "email.failed",
    rendering_failure: "email.failed",
    deliverydelay: "email.delayed",
    delivery_delay: "email.delayed",
  };
  return types[normalized] ?? null;
}

async function loadCertificate(url: string) {
  const cached = certificateCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.pem;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
      headers: { "user-agent": "SvetPovoljnihCena-SNS/1.0" },
    });
    if (!response.ok) throw new Error(`sns_certificate_http_${response.status}`);
    const pem = await response.text();
    if (!pem.includes("BEGIN CERTIFICATE") || pem.length > 100_000) {
      throw new Error("sns_certificate_invalid");
    }
    certificateCache.set(url, {
      pem,
      expiresAt: Date.now() + 6 * 60 * 60 * 1000,
    });
    return pem;
  } finally {
    clearTimeout(timeout);
  }
}
