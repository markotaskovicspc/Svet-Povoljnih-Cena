import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveDeliveryQuote } from "@/lib/checkout/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const quoteSchema = z.object({
  city: z.string().max(120).optional().nullable(),
  lines: z
    .array(
      z.object({
        sku: z.string().min(1).max(80),
        qty: z.int().positive().max(99).optional(),
      }),
    )
    .max(50)
    .default([]),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = quoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const quote = await resolveDeliveryQuote(parsed.data);
  return NextResponse.json({ ok: true, data: quote });
}
