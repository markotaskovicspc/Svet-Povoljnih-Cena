import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  cartPayloadSchema,
  clearServerCart,
  getServerCart,
  mergeServerCart,
  saveServerCart,
} from "@/lib/api/cart";
import { shouldMergeLegacyCommerceAfterLogin } from "@/lib/api/commerce-sync";

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
  const syncMode = req.headers.get("x-spc-cart-sync");
  // Explicit merge protects current clients. The short legacy fallback also
  // protects tabs that were left open across a deploy and still run an older
  // bundle without the header.
  const merge =
    syncMode === "merge" ||
    (syncMode === null &&
      (await shouldMergeLegacyCommerceAfterLogin(user.id)));
  if (merge) {
    await mergeServerCart(user.id, parsed.data.lines);
  } else {
    await saveServerCart(user.id, parsed.data.lines);
  }
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
