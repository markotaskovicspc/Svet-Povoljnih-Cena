import { NextResponse } from "next/server";
import { z } from "zod";
import { subscribeNewsletter, subscribeSchema, unsubscribeNewsletter } from "@/lib/api/newsletter";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.flatten() }, { status: 400 });
  }
  const limited = checkRateLimitForRequest(
    req,
    "newsletter:subscribe",
    RATE_LIMITS.newsletter,
    [parsed.data.email],
  );
  if (!limited.ok) {
    return rateLimitJson(limited);
  }
  const sub = await subscribeNewsletter(parsed.data);
  return NextResponse.json({ ok: true, email: sub.email }, { status: 201 });
}

const unsubBody = z.object({ email: z.email() });

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = unsubBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const limited = checkRateLimitForRequest(
    req,
    "newsletter:unsubscribe",
    RATE_LIMITS.newsletter,
    [parsed.data.email],
  );
  if (!limited.ok) {
    return rateLimitJson(limited);
  }
  try {
    await unsubscribeNewsletter(parsed.data.email);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
