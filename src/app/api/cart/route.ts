import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { cartPayloadSchema, getServerCart, saveServerCart, clearServerCart } from "@/lib/api/cart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.userType !== "customer") {
    return NextResponse.json({ lines: [] });
  }
  return NextResponse.json({ lines: await getServerCart(user.id) });
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.userType !== "customer") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const parsed = cartPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.flatten() }, { status: 400 });
  }
  await saveServerCart(user.id, parsed.data.lines);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user || user.userType !== "customer") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await clearServerCart(user.id);
  return NextResponse.json({ ok: true });
}
