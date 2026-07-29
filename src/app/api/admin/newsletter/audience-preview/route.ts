import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import {
  newsletterAudienceFilterSchema,
  previewNewsletterAudience,
} from "@/lib/newsletter/audience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await requireAdminAction(["ADS"]);
  const body = await request.json().catch(() => null);
  const parsed = newsletterAudienceFilterSchema.safeParse(body?.filter);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Filter nije ispravan." },
      { status: 400 },
    );
  }
  const preview = await previewNewsletterAudience(parsed.data);
  return NextResponse.json({ ok: true, ...preview });
}
