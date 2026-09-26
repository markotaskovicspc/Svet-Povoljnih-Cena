import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifySocialRequest } from "@/lib/social/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ sender: z.email(), number: z.string().regex(/^SPC-\d{4}-\d+$/).optional() });

// Draft-only lookup: the sender is supplied by the mailbox worker, never by the model.
// A matching email is context for a human reviewer, not authority to mutate an order.
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.SOCIAL_INTEGRATION_SECRET ?? "";
  if (raw.length > 2048 || secret.length < 32 || !verifySocialRequest(raw, req.headers.get("x-spc-timestamp") ?? "", req.headers.get("x-spc-signature") ?? "", secret)) return new Response(null, { status: 401 });
  let input;
  try { input = schema.parse(JSON.parse(raw)); } catch { return new Response(null, { status: 400 }); }
  const orders = await db.order.findMany({
    where: { ...(input.number ? { number: input.number } : {}), OR: [
      { guestEmail: { equals: input.sender, mode: "insensitive" } },
      { user: { email: { equals: input.sender, mode: "insensitive" } } },
    ] },
    orderBy: { createdAt: "desc" }, take: 5,
    select: { number: true, status: true, createdAt: true, total: true, paymentMethod: true,
      items: { select: { sku: true, name: true, qty: true } },
      shipments: { select: { trackingNo: true, status: true }, take: 3 },
      reclamations: { select: { number: true, status: true, sku: true }, take: 5, orderBy: { createdAt: "desc" } },
    },
  });
  return NextResponse.json({ ok: true, orders, note: "Podaci su namenjeni nacrtu koji zaposleni proverava. Nisu potvrda identiteta niti odobrenje izmene, otkazivanja ili povraćaja." }, { headers: { "Cache-Control": "no-store" } });
}
