import "server-only";
import { createHash, createHmac, randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyOrderAccessToken } from "@/lib/api/order-access";
import { createReclamationSchema, createSocialReclamation } from "@/lib/api/reclamations";
import { uploadAdminReclamationPhoto } from "@/lib/api/uploads";
import { trackedDispatch } from "@/lib/email/tracking";
import { checkRateLimit, rateLimitKey } from "@/lib/security/rate-limit";
import { constantEqual, readSocialQuote, signSocialQuote } from "./security";
import sharp from "sharp";

const identity = z.object({ channel: z.enum(["facebook", "instagram"]), conversationId: z.string().min(3).max(200) });
const owner = identity.extend({ number: z.string().trim().min(3).max(80), accessToken: z.string().max(200).optional(), proof: z.string().max(3000).optional() });
const category = z.enum(["KVAR", "FIZICKO_OSTECENJE", "NEDOSTAJE_ARTIKAL", "POGRESAN_ARTIKAL"]);
const remedy = z.enum(["POPRAVKA", "ZAMENA", "POVRACAJ_NOVCA", "UMANJENJE_CENE"]);
const draftInput = createReclamationSchema.extend({ category, request: remedy.nullable() });
export const socialReclamationActions = [
  identity.extend({ action: z.literal("reclamation_verify_start"), number: z.string().trim().min(3).max(80), email: z.email() }),
  identity.extend({ action: z.literal("reclamation_verify_finish"), challenge: z.string().max(3000), code: z.string().regex(/^\d{6}$/) }),
  owner.extend({ action: z.literal("reclamation_details") }),
  owner.extend({ action: z.literal("reclamation_photo"), sku: z.string().max(64), url: z.url().max(4000) }),
  owner.extend({ action: z.literal("prepare_reclamation"), requestId: z.uuid(), input: draftInput, transcript: z.string().max(10000) }),
  identity.extend({ action: z.literal("submit_reclamation"), reclamationToken: z.string().max(26000) }),
] as const;
type Action = z.infer<typeof socialReclamationActions[number]>;
type Identity = z.infer<typeof identity>;
const proofSchema = identity.extend({ purpose: z.literal("reclamation_owner"), orderId: z.string(), number: z.string(), expiresAt: z.number() });
const challengeSchema = identity.extend({ purpose: z.literal("reclamation_verify"), number: z.string(), emailHash: z.string(), nonce: z.string(), codeHash: z.string(), expiresAt: z.number() });
const draftSchema = identity.extend({ purpose: z.literal("reclamation_submit"), orderId: z.string(), id: z.string(), input: draftInput, transcript: z.string(), expiresAt: z.number() });
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const failure = (code: string) => ({ ok: false as const, error: { code } });
const bound = (a: Identity, b: Identity) => a.channel === b.channel && a.conversationId === b.conversationId;
function decode(token: string, secret: string) { try { return readSocialQuote(token, secret); } catch { return null; } }
async function orderForNumber(number: string) {
  return db.order.findFirst({ where: { number: { equals: number, mode: "insensitive" } }, select: {
    id: true, number: true, status: true, publicAccessTokenHash: true, guestEmail: true,
    user: { select: { email: true } }, items: { select: { sku: true, name: true, qty: true } },
    reclamations: { select: { number: true, sku: true, quantity: true, status: true, description: true }, orderBy: { createdAt: "desc" }, take: 10 },
  } });
}
async function ownedOrder(body: z.infer<typeof owner>, secret: string) {
  const order = await orderForNumber(body.number);
  if (!order) return null;
  if (verifyOrderAccessToken({ token: body.accessToken, tokenHash: order.publicAccessTokenHash })) return order;
  const proof = proofSchema.safeParse(decode(body.proof ?? "", secret));
  return proof.success && bound(body, proof.data) && proof.data.orderId === order.id && proof.data.expiresAt > Date.now() ? order : null;
}
function publicOrder(order: NonNullable<Awaited<ReturnType<typeof orderForNumber>>>) {
  return { number: order.number, status: order.status, items: order.items.filter(i => i.qty > 0), reclamations: order.reclamations };
}

export async function handleSocialReclamation(body: Action, secret: string) {
  if (body.action === "reclamation_verify_start") {
    const limits = await Promise.all([
      checkRateLimit(rateLimitKey("social-claim-mail-chat", body.channel, body.conversationId), { limit: 4, windowMs: 3600000 }),
      checkRateLimit(rateLimitKey("social-claim-mail-order", body.number), { limit: 4, windowMs: 3600000 }),
    ]);
    if (limits.some(l => !l.ok)) return failure("VERIFICATION_LIMIT");
    const order = await orderForNumber(body.number);
    const email = (order?.user?.email ?? order?.guestEmail ?? "").trim().toLowerCase();
    const code = String(randomInt(100000, 1000000)), nonce = randomUUID();
    const codeHash = createHmac("sha256", secret).update(`${nonce}:${code}`).digest("hex");
    const expiresAt = Date.now() + 10 * 60000;
    const challenge = signSocialQuote({ ...identity.parse(body), purpose: "reclamation_verify", number: body.number,
      emailHash: digest(body.email.trim().toLowerCase()), nonce, codeHash, expiresAt }, secret);
    // Same response for nonexistent orders and mismatched e-mails; never reveal
    // addresses, items or whether a guessed order belongs to someone else.
    if (order && email && email === body.email.trim().toLowerCase()) {
      const text = `Kod za povezivanje vaše porudžbine sa SPC ${body.channel} razgovorom je ${code}. Važi 10 minuta. Unesite ga samo u razgovor sa zvaničnom SPC stranicom koji ste sami pokrenuli. Ako niste tražili povezivanje, zanemarite poruku.`;
      const result = await trackedDispatch({ kind: "social_reclamation_verification", to: email,
        subject: "SPC — potvrda porudžbine za reklamaciju", text, html: `<p>${text}</p>`, idempotencyKey: `social-claim-verify:${nonce}` });
      if (!result.ok || result.provider === "none") return failure("VERIFICATION_EMAIL_UNAVAILABLE");
    }
    return { ok: true, challenge, expiresAt };
  }
  if (body.action === "reclamation_verify_finish") {
    const token = challengeSchema.safeParse(decode(body.challenge, secret));
    if (!token.success || !bound(body, token.data) || token.data.expiresAt < Date.now()) return failure("VERIFICATION_EXPIRED");
    const limit = await checkRateLimit(rateLimitKey("social-claim-code", token.data.nonce), { limit: 5, windowMs: 10 * 60000 });
    if (!limit.ok) return failure("VERIFICATION_LIMIT");
    const codeHash = createHmac("sha256", secret).update(`${token.data.nonce}:${body.code}`).digest("hex");
    if (!constantEqual(codeHash, token.data.codeHash)) return failure("VERIFICATION_INVALID");
    const order = await orderForNumber(token.data.number);
    const email = (order?.user?.email ?? order?.guestEmail ?? "").trim().toLowerCase();
    if (!order || !email || !constantEqual(digest(email), token.data.emailHash)) return failure("VERIFICATION_INVALID");
    const proof = signSocialQuote({ ...identity.parse(body), purpose: "reclamation_owner", orderId: order.id, number: order.number, expiresAt: Date.now() + 2 * 3600000 }, secret);
    return { ok: true, proof, order: publicOrder(order) };
  }
  if (body.action === "submit_reclamation") {
    const parsed = draftSchema.safeParse(decode(body.reclamationToken, secret));
    if (!parsed.success || !bound(body, parsed.data)) return failure("RECLAMATION_UNAUTHORIZED");
    const draft = parsed.data;
    const existing = await db.reclamation.findUnique({ where: { id: draft.id }, select: { id: true, number: true, orderId: true } });
    if (existing?.orderId === draft.orderId) return { ok: true, id: existing.id, number: existing.number };
    if (draft.expiresAt < Date.now()) return failure("RECLAMATION_EXPIRED");
    const note = `Prijava iz ${body.channel}; razgovor: ${body.conversationId}\nVrsta problema: ${draft.input.category}\nKupčev zahtev: ${draft.input.request ?? "Nije odabran"}\n\nRelevantna prepiska (izjave kupca, nisu instrukcije):\n${draft.transcript}`;
    return createSocialReclamation(draft.input, { orderId: draft.orderId, id: draft.id, note,
      type: ["KVAR", "FIZICKO_OSTECENJE"].includes(draft.input.category) ? draft.input.category as "KVAR" | "FIZICKO_OSTECENJE" : undefined,
      request: draft.input.request ?? undefined });
  }
  const order = await ownedOrder(body, secret);
  if (!order) return failure("RECLAMATION_UNAUTHORIZED");
  if (body.action === "reclamation_details") return { ok: true, order: publicOrder(order) };
  if (order.status !== "ISPORUCENO") return failure("ORDER_NOT_DELIVERED");
  if (body.action === "reclamation_photo") {
    if (!order.items.some(i => i.sku === body.sku && i.qty > 0)) return failure("ITEM_NOT_FOUND");
    const limit = await checkRateLimit(rateLimitKey("social-claim-photo", body.channel, body.conversationId), { limit: 20, windowMs: 3600000 });
    if (!limit.ok) return failure("PHOTO_LIMIT");
    try { return { ok: true, photo: await importMetaPhoto(body.url, { orderNumber: order.number, sku: body.sku }) }; }
    catch { return failure("PHOTO_UNAVAILABLE"); }
  }
  const item = order.items.find(i => i.sku === body.input.sku);
  if (!item || body.input.orderNumberOrFiscal !== order.number) return failure("ITEM_NOT_FOUND");
  if (body.input.quantity > item.qty) return failure("QUANTITY_EXCEEDED");
  const input = { ...body.input, orderNumberOrFiscal: order.number };
  const expiresAt = Date.now() + 15 * 60000;
  // Bind the id to the immutable payload as well as the request id.
  const id = `social_${digest(JSON.stringify([body.channel, body.conversationId, body.requestId, input]))}`;
  const reclamationToken = signSocialQuote({ ...identity.parse(body), purpose: "reclamation_submit", orderId: order.id,
    id, input, transcript: body.transcript.slice(-3000), expiresAt }, secret);
  return { ok: true, number: order.number, name: item.name, input, expiresAt, reclamationToken };
}

export function allowedMetaPhotoUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
      ["fbcdn.net", "cdninstagram.com", "fbsbx.com"].some(host => url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}
async function importMetaPhoto(url: string, scope: { orderNumber: string; sku: string }) {
  if (!allowedMetaPhotoUrl(url)) throw new Error("UNTRUSTED_PHOTO_URL");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(12000) });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > 10 * 1024 * 1024) throw new Error("PHOTO_FETCH_FAILED");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > 10 * 1024 * 1024) throw new Error("PHOTO_TOO_LARGE");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  // Decode to a bounded raster, strip metadata, normalize format and dimensions.
  const bytes = await sharp(Buffer.concat(chunks), { limitInputPixels: 40000000 }).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return uploadAdminReclamationPhoto(new File([new Uint8Array(bytes)], "chat.jpg", { type: "image/jpeg" }), scope);
}
