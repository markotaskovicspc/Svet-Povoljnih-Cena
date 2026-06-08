import { NextResponse } from "next/server";
import {
  applyEmailUnsubscribe,
  syncNewsletterSubscriberToResend,
  syncUserMarketingConsentToResend,
  verifyEmailUnsubscribeToken,
} from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const payload = verifyEmailUnsubscribeToken(token);
  if (!payload) {
    return htmlPage("Link nije važeći", "Link je istekao ili nije ispravan.", null);
  }
  return htmlPage(
    titleFor(payload.purpose),
    textFor(payload.purpose),
    `<form method="post"><button type="submit">Potvrdi</button></form>`,
  );
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const payload = verifyEmailUnsubscribeToken(token);
  if (!payload) {
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 400 });
  }

  const result = await applyEmailUnsubscribe(payload);
  if (payload.purpose === "newsletter") {
    void syncNewsletterSubscriberToResend(payload.email).catch((err) => {
      console.error("[email] Resend unsubscribe sync failed", err);
    });
  }
  if (payload.purpose === "marketing") {
    void syncUserMarketingConsentToResend(payload.userId).catch((err) => {
      console.error("[email] Resend marketing unsubscribe sync failed", err);
    });
  }

  return NextResponse.json({ ok: true, kind: result.kind });
}

function titleFor(purpose: string) {
  if (purpose === "alert") return "Isključivanje obaveštenja";
  if (purpose === "marketing") return "Odjava od promotivnih mejlova";
  return "Odjava od newslettera";
}

function textFor(purpose: string) {
  if (purpose === "alert") {
    return "Potvrdite da želite da isključite ovo obaveštenje za proizvod.";
  }
  if (purpose === "marketing") {
    return "Potvrdite da više ne želite promotivne mejlove.";
  }
  return "Potvrdite da više ne želite newsletter poruke.";
}

function htmlPage(title: string, text: string, action: string | null) {
  return new Response(
    `<!doctype html>
<html lang="sr-Latn">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body{margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#faf7f2;color:#1a1714}
    main{min-height:100vh;display:grid;place-items:center;padding:24px}
    section{max-width:520px;background:#fff;border:1px solid #e8e0d2;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(46,35,24,.08)}
    h1{font-family:Georgia,serif;font-size:28px;margin:0 0 10px}
    p{line-height:1.6;color:#3b342d}
    button{border:0;border-radius:999px;background:#1a1714;color:#faf7f2;padding:12px 22px;font-weight:600;cursor:pointer}
  </style>
</head>
<body><main><section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>${action ?? ""}</section></main></body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
