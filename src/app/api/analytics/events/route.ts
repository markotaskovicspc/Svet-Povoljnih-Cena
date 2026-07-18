import { NextResponse } from "next/server";
import { AnalyticsEventType } from "@prisma/client";
import { db } from "@/lib/db";
import {
  checkRateLimitForRequest,
  rateLimitJson,
} from "@/lib/security/rate-limit";

const PUBLIC_EVENT_TYPES = new Set<AnalyticsEventType>([
  "PAGE_VIEW",
  "PRODUCT_VIEW",
  "ADD_TO_CART",
  "CHECKOUT_STARTED",
]);

function hasAnalyticsConsent(request: Request) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .includes("spc_cookie_consent=analytics");
}

export async function POST(request: Request) {
  if (!hasAnalyticsConsent(request)) {
    return NextResponse.json(
      { ok: false, error: "analytics_consent_required" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  const limited = await checkRateLimitForRequest(request, "analytics-events", {
    limit: 120,
    windowMs: 60_000,
  });
  if (!limited.ok) return rateLimitJson(limited);

  const body = (await request.json().catch(() => null)) as
    | {
        type?: unknown;
        anonymousId?: unknown;
        sessionId?: unknown;
        path?: unknown;
        productId?: unknown;
        quantity?: unknown;
        value?: unknown;
        consentVersion?: unknown;
        metadata?: unknown;
      }
    | null;
  const type =
    typeof body?.type === "string" && PUBLIC_EVENT_TYPES.has(body.type as AnalyticsEventType)
      ? (body.type as AnalyticsEventType)
      : null;
  const anonymousId =
    typeof body?.anonymousId === "string" ? body.anonymousId.trim() : "";
  const consentVersion =
    typeof body?.consentVersion === "string" ? body.consentVersion.trim() : "";
  const quantity =
    typeof body?.quantity === "number" && Number.isInteger(body.quantity)
      ? body.quantity
      : null;
  const value =
    typeof body?.value === "number" && Number.isFinite(body.value) ? body.value : null;

  if (
    !type ||
    !anonymousId ||
    anonymousId.length > 96 ||
    !consentVersion ||
    consentVersion.length > 40 ||
    (quantity !== null && (quantity < 1 || quantity > 10_000)) ||
    (value !== null && (value < 0 || value > 1_000_000_000))
  ) {
    return NextResponse.json(
      { ok: false, error: "Neispravan analytics događaj." },
      { status: 400 },
    );
  }

  const productId =
    typeof body?.productId === "string" && body.productId ? body.productId : null;
  if (productId) {
    const exists = await db.product.count({ where: { id: productId } });
    if (!exists) {
      return NextResponse.json({ ok: false, error: "Artikal ne postoji." }, { status: 400 });
    }
  }
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 13);
  const event = await db.analyticsEvent.create({
    data: {
      type,
      anonymousId,
      sessionId:
        typeof body?.sessionId === "string" ? body.sessionId.slice(0, 96) : null,
      path: typeof body?.path === "string" ? body.path.slice(0, 500) : null,
      productId,
      quantity,
      value,
      consentVersion,
      metadata:
        body?.metadata &&
        typeof body.metadata === "object" &&
        !Array.isArray(body.metadata)
          ? body.metadata
          : undefined,
      expiresAt,
    },
    select: { id: true },
  });
  return NextResponse.json(
    { ok: true, id: event.id },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
