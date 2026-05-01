import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { addressSchema, deleteAddress, getAddress, updateAddress } from "@/lib/api/addresses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;
  const item = await getAddress(user.id, id);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const item = await updateAddress(user.id, id, parsed.data);
    return NextResponse.json({ item });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;
  const ok = await deleteAddress(user.id, id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
