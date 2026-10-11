import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { subscribeToRestock } from "@/lib/email/restock";
import { checkRateLimitForRequest, rateLimitJson, RATE_LIMITS } from "@/lib/security/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ sku: z.string().trim().min(1).max(64), email: z.email().max(254).optional(), website: z.string().max(200).optional() });
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return NextResponse.json({ error: "Zahtev nije dozvoljen." }, { status: 403 });
  const rate = await checkRateLimitForRequest(req, "restock", RATE_LIMITS.newsletter);
  if (!rate.ok) return rateLimitJson(rate);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unesite ispravnu email adresu." }, { status: 400 });
  if (parsed.data.website) return NextResponse.json({ ok: true });
  const session = await getCurrentUser();
  const user = session?.userType === "customer" ? await db.user.findUnique({ where: { id: session.id }, select: { id: true, email: true, deletedAt: true } }) : null;
  if (user?.deletedAt) return NextResponse.json({ error: "Prijavite se ponovo." }, { status: 401 });
  const email = user?.email ?? parsed.data.email;
  if (!email) return NextResponse.json({ error: "Unesite email adresu." }, { status: 400 });
  try {
    await subscribeToRestock(parsed.data.sku, email, user?.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error && /^(Artikal|Ova adresa)/.test(err.message) ? err.message : "Prijava trenutno nije uspela. Pokušajte ponovo.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
