import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { getCurrentAdmin } from "@/lib/auth/session";
import { isAuthorized, logAudit } from "@/lib/admin";
import { db } from "@/lib/db";
import { envValue } from "@/lib/env";
import { checkRateLimitForRequest, rateLimitJson } from "@/lib/security/rate-limit";
import { createOrder } from "@/lib/api/checkout";
import { channelOrderSchema } from "@/lib/checkout/order-schema";
import { importDraftSchema, withImportDefaults } from "@/lib/admin/order-import/schema";
import { createImportMatcher } from "@/lib/admin/order-import/matching";
import { readImportQuote, signImportQuote } from "@/lib/admin/order-import/quote";
import { resolveImportAddress, resolveImportAlias, IMPORT_TOWN_ERROR } from "@/lib/admin/order-import/address";

export const runtime = "nodejs";
export const maxDuration = 60;
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
async function catalogMatcher() {
  const catalog = await db.product.findMany({
    where: { deletedAt: null, isActive: true },
    select: { sku: true, name: true, shortName: true, barcode: true, shortDescription: true, colorPrimary: true, colorSecondary: true, sizeLabel: true, attribute1: true, attribute2: true, attribute3: true, attribute4: true },
  });
  return createImportMatcher(catalog);
}
export async function GET(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return fail("Prijavite se u ERP ponovo.", 401);
  if (!isAuthorized(admin.role, ["OPS"])) return fail("Nemate pristup.", 403);
  const query = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 200) return fail("Unesite naziv ili šifru artikla.");
  return NextResponse.json({ products: (await catalogMatcher())({ name: query, sku: "", qty: null, unitPrice: null }) });
}
export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return fail("Prijavite se u ERP ponovo.", 401);
  if (!isAuthorized(admin.role, ["OPS"])) return fail("Nemate pristup.", 403);
  if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") return fail("Zahtev nije dozvoljen.", 403);
  const limited = await checkRateLimitForRequest(req, `order-import-${admin.id}`, { limit: 12, windowMs: 60000 });
  if (!limited.ok) return rateLimitJson(limited);
  const secret = envValue("SOCIAL_INTEGRATION_SECRET");
  if (!secret) return fail("Veza sa chatbotom nije podešena.", 503);
  if (Number(req.headers.get("content-length") ?? 0) > 3500000) return fail("Slika je prevelika. Najviše 3 MB.", 413);
  try {
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData();
      const text = String(form.get("text") ?? "").trim();
      if (text.length > 30000) return fail("Chat može imati najviše 30.000 znakova.");
      const file = form.get("image");
      let image: string | undefined;
      if (file instanceof File && file.size) {
        if (file.size > 3000000 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) return fail("Dodajte PNG, JPG ili WebP sliku do 3 MB.");
        const bytes = Buffer.from(await file.arrayBuffer());
        const processor = sharp(bytes, { limitInputPixels: 20000000 });
        const metadata = await processor.metadata();
        if (!["png", "jpeg", "webp"].includes(metadata.format ?? "")) return fail("Format slike nije podržan.");
        const resized = await processor.rotate().resize({ width: 2200, height: 3000, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
        if (resized.length > 2500000) return fail("Slika je prevelika. Dodajte kraći screenshot.", 413);
        image = `data:image/webp;base64,${resized.toString("base64")}`;
      }
      if (!text && !image) return fail("Dodajte sliku ili nalepite chat.");
      const response = await fetch("https://spc-chatbot-production.up.railway.app/operator/order-import", {
        method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ text, image }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(50000),
      });
      if (!response.ok) return fail(response.status === 429 ? "GPT trenutno obrađuje druge porudžbine. Pokušajte za nekoliko sekundi." : "GPT trenutno nije pročitao porudžbinu. Pokušajte ponovo.", response.status === 429 ? 429 : 502);
      const payload = await response.json();
      const draft = withImportDefaults(importDraftSchema.parse(payload.draft));
      const match = await catalogMatcher();
      const lines = draft.lines.map(line => {
        const candidates = match(line);
        const best = candidates[0];
        return { ...line, sku: best?.sku ?? "", suggested: best?.matchKind === "suggested", candidates };
      });
      const locality = draft.shippingMethod === "KURIR" ? await resolveImportAlias(draft.city) : null;
      const warnings = locality && (draft.city !== locality.city || draft.postalCode !== locality.postalCode)
        ? [...draft.warnings.filter(w => !(/po[šs]tanski broj/i.test(w) && /nedostaje|nije naveden|nije dat|nije unet|nepoznat/i.test(w))), `Mesto i poštanski broj su dopunjeni: ${locality.city}, ${locality.postalCode}. Proverite adresu.`]
        : draft.warnings;
      return NextResponse.json({ draft: { ...draft, ...(locality ?? {}), warnings, lines } });
    }
    const body = await req.json();
    if (body.action === "preview") {
      const parsed = channelOrderSchema.safeParse(body.input);
      if (!parsed.success) {
        const labels: Record<string, string> = { firstName: "ime", lastName: "prezime", phone: "telefon", street: "ulica", houseNumber: "kućni broj", city: "mesto", postalCode: "poštanski broj (5 cifara)", guestEmail: "e-pošta", paymentMethod: "plaćanje", shippingMethod: "dostava", sku: "artikal", qty: "količina" };
        return fail("Proverite ili dopunite: " + [...new Set(parsed.error.issues.map(i => labels[String(i.path.at(-1))] ?? "podatke porudžbine"))].join(", ") + ".");
      }
      const resolved = await resolveImportAddress(parsed.data);
      if (!resolved) return fail(IMPORT_TOWN_ERROR);
      const input = { ...resolved, checkoutSessionId: randomUUID(), notes: "Porudžbina pripremljena iz chata/slike u ERP-u." };
      const result = await createOrder(input, null, null, { previewOnly: true, allowGuestWithoutEmail: true, preserveCustomerPostalCode: true });
      if (!result.ok) return fail(orderError(result.error));
      return NextResponse.json({ quote: signImportQuote({ actorId: admin.id, expires: Date.now() + 15 * 60000, input, total: result.data.total }, secret), totals: result.data, shipping: input.shipping });
    }
    const create = z.object({ action: z.literal("create"), quote: z.string().max(60000), confirmed: z.literal(true) }).parse(body);
    const quote = readImportQuote(create.quote, secret, admin.id);
    const resolved = await resolveImportAddress(quote.input);
    if (!resolved) return fail(IMPORT_TOWN_ERROR);
    const result = await createOrder(resolved, null, null, { expectedTotal: quote.total, allowGuestWithoutEmail: true, preserveCustomerPostalCode: true, customerReplyDraftOnly: !quote.input.guestEmail, adminActorId: admin.id });
    if (!result.ok) return fail(orderError(result.error));
    await logAudit({ actorId: admin.id, action: "erp.order-import.create", entity: "Order", entityId: result.data.id, diff: { number: result.data.number } });
    return NextResponse.json({ order: { id: result.data.id, number: result.data.number } });
  } catch (error) {
    if (error instanceof z.ZodError) return fail("Podatke nije moguće pročitati. Proverite ih i pokušajte ponovo.");
    if (error instanceof Error && /Pregled/.test(error.message)) return fail(error.message);
    return fail("Zahtev nije potvrđen. Kod kreiranja porudžbine ponovite isti pokušaj; nemojte praviti novi pregled dok ne proverite listu porudžbina.", 502);
  }
}
function orderError(error: { code: string; sku?: string; reason?: string }) {
  const messages: Record<string, string> = {
    OUT_OF_STOCK: `Nema dovoljno zaliha za ${error.sku ?? "artikal"}.`, INACTIVE: `Artikal ${error.sku ?? ""} nije dostupan.`,
    PRICE_CHANGED: "Cena se promenila. Proverite iznose ponovo.", DELIVERY_ADDRESS_INVALID: "Proverite adresu, grad i kućni broj.",
    DELIVERY_UNAVAILABLE: "Dostava nije dostupna za ovu adresu ili artikle.", PAYMENT_UNAVAILABLE: "Izabrani način plaćanja nije dostupan.",
    CHECKOUT_SESSION_MISMATCH: "Ovaj pokušaj već pripada drugoj porudžbini. Proverite listu porudžbina.",
  };
  return messages[error.code] ?? error.reason ?? "Porudžbina nije spremna. Proverite podatke i artikle.";
}
