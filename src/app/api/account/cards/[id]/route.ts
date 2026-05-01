import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { deleteSavedCard, setDefaultCard } from "@/lib/api/cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;
  try {
    const item = await setDefaultCard(user.id, id);
    return NextResponse.json({ item });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;
  const ok = await deleteSavedCard(user.id, id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
