import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { commentSchema, submitComment } from "@/lib/api/comments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = commentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.flatten() }, { status: 400 });
  }
  const user = await getCurrentUser();
  const userId = user?.userType === "customer" ? user.id : null;
  const created = await submitComment(parsed.data, userId);
  return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
}
