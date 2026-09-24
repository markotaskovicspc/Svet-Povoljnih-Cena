import { after, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createOrder, createOrderSchema } from "@/lib/api/checkout";
import { getProductBySku, listProducts } from "@/lib/api/catalog";
import { resolveProductPriceQuote } from "@/lib/pricing";
import { db } from "@/lib/db";
import { verifyOrderAccessToken } from "@/lib/api/order-access";
import { createGuestReclamation, createReclamationSchema } from "@/lib/api/reclamations";
import { verifySocialRequest, signSocialQuote, readSocialQuote } from "@/lib/social/security";
import { checkoutFollowUpKey } from "@/lib/checkout/outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const identity = z.object({ channel: z.enum(["facebook", "instagram"]), conversationId: z.string().min(3).max(200) });
const quotePayload = identity.extend({ input: createOrderSchema, total: z.number().nonnegative(), expiresAt: z.number() });
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("search"), query: z.string().trim().min(1).max(100) }),
  identity.extend({ action: z.literal("quote"), input: createOrderSchema }),
  identity.extend({ action: z.literal("create_order"), quoteToken: z.string().max(20000) }),
  z.object({ action: z.literal("order_status"), number: z.string().max(80), accessToken: z.string().max(200) }),
  z.object({ action: z.literal("reclamation"), input: createReclamationSchema, accessToken: z.string().max(200) }),
]);

export async function POST(req: Request) {
  const secret = process.env.SOCIAL_INTEGRATION_SECRET ?? "";
  if (secret.length < 32) return NextResponse.json({ error: "INTEGRATION_NOT_CONFIGURED" }, { status: 503 });
  const raw = await req.text();
  if (Buffer.byteLength(raw) > 32768) return new Response(null, { status: 413 });
  if (!verifySocialRequest(raw, req.headers.get("x-spc-timestamp") ?? "", req.headers.get("x-spc-signature") ?? "", secret)) {
    return new Response(null, { status: 401 });
  }
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "INVALID", issues: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;
  try {
    if (body.action === "search") {
      const exact = await getProductBySku(body.query);
      const products = exact ? [exact] : (await listProducts({ nameKeyword: body.query, limit: 6 }, { throwOnError: true })).items;
      return NextResponse.json({ ok: true, items: products.map(p => ({
        sku: p.sku, name: p.name, slug: p.slug,
        price: resolveProductPriceQuote(p, { loggedIn: false }).payable.effective,
        available: p.stock > 0, image: p.media.images[0] ?? null,
      })) });
    }
    if (body.action === "quote") {
      // Auth identity and discounts cannot be supplied by the model.
      const input = createOrderSchema.parse({ ...body.input, checkoutSessionId: undefined, guestLoyalty: false, useSavedCard: false,
        analytics: undefined, voucherCode: undefined,
        notes: `[${body.channel.toUpperCase()}] ${body.conversationId}`,
      });
      if (!["POUZECE_GOTOVINA", "UPLATA_NA_RACUN"].includes(input.paymentMethod)) {
        return NextResponse.json({ ok: false, error: { code: "CHAT_PAYMENT_UNSUPPORTED" } });
      }
      const preview = await createOrder(input, null, null, { previewOnly: true });
      if (!preview.ok) return NextResponse.json(preview);
      input.checkoutSessionId = `social_${randomUUID().replaceAll("-", "")}`;
      const expiresAt = Date.now() + 15 * 60_000;
      const quoteToken = signSocialQuote({ channel: body.channel, conversationId: body.conversationId, input, total: preview.data.total, expiresAt }, secret);
      const { id: _id, number: _number, accessToken: _token, ...totals } = preview.data;
      return NextResponse.json({ ok: true, quoteToken, expiresAt, totals, input });
    }
    if (body.action === "create_order") {
      const quote = quotePayload.parse(readSocialQuote(body.quoteToken, secret));
      if (quote.channel !== body.channel || quote.conversationId !== body.conversationId) return new Response(null, { status: 403 });
      // Permit recovery of a committed order after response loss, even after expiry.
      const existing = await db.checkoutSession.findUnique({ where: { id: quote.input.checkoutSessionId! }, select: { orderId: true } });
      if (quote.expiresAt < Date.now() && !existing?.orderId) return NextResponse.json({ ok: false, error: { code: "QUOTE_EXPIRED" } });
      const result = await createOrder(quote.input, null, null, { expectedTotal: quote.total });
      if (result.ok) {
        after(async () => {
          try {
            const job = await db.backgroundJob.findUnique({ where: { idempotencyKey: checkoutFollowUpKey(result.data.id) }, select: { id: true } });
            if (job) { const { processBackgroundJob } = await import("@/lib/background-jobs"); await processBackgroundJob(job.id); }
          } catch { console.error("social.checkout.follow_up_failed"); }
        });
      }
      return NextResponse.json(result);
    }
    if (body.action === "order_status") {
      const order = await db.order.findUnique({ where: { number: body.number }, select: { number: true, status: true, publicAccessTokenHash: true } });
      if (!order || !verifyOrderAccessToken({ token: body.accessToken, tokenHash: order.publicAccessTokenHash })) return new Response(null, { status: 403 });
      return NextResponse.json({ ok: true, number: order.number, status: order.status });
    }
    return NextResponse.json(await createGuestReclamation(body.input, body.accessToken));
  } catch {
    // Never log raw requests, addresses, tokens or upstream error bodies.
    console.error("social.integration.request_failed", { action: body.action });
    return NextResponse.json({ ok: false, error: { code: "INTEGRATION_ERROR" } }, { status: 503 });
  }
}
