import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import {
  alertChannelSchema,
  listWishlist,
  setWishlistAlerts,
  toggleWishlist,
} from "@/lib/api/wishlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  return NextResponse.json({ items: await listWishlist(user.id) });
}

const toggleBody = z.object({ sku: z.string().min(1).max(64) });

export async function POST(req: Request) {
  const user = await requireUser();
  const body = await req.json().catch(() => null);
  const parsed = toggleBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  try {
    const inWishlist = await toggleWishlist(user.id, parsed.data.sku);
    return NextResponse.json({ inWishlist });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}

const patchBody = z.object({
  sku: z.string().min(1).max(64),
  notifyOnSale: z.boolean().optional(),
  notifyOnRestock: z.boolean().optional(),
  channel: alertChannelSchema.optional(),
});

export async function PATCH(req: Request) {
  const user = await requireUser();
  const body = await req.json().catch(() => null);
  const parsed = patchBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  try {
    await setWishlistAlerts(
      user.id,
      parsed.data.sku,
      {
        notifyOnSale: parsed.data.notifyOnSale,
        notifyOnRestock: parsed.data.notifyOnRestock,
      },
      parsed.data.channel ?? "EMAIL",
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
