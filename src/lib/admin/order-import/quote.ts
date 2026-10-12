import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { channelOrderSchema } from "@/lib/checkout/order-schema";
const quoteSchema = z.object({ actorId: z.string(), expires: z.number(), input: channelOrderSchema, total: z.number().nonnegative(), staffLoyalty: z.boolean().optional() });
export type ImportQuote = z.infer<typeof quoteSchema>;
export function signImportQuote(quote: ImportQuote, secret: string) {
  const body = Buffer.from(JSON.stringify(quote)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("hex")}`;
}
export function readImportQuote(token: string, secret: string, actorId: string, now = Date.now()) {
  const [body, signature, extra] = token.split(".");
  if (!body || extra || !/^[a-f0-9]{64}$/.test(signature ?? "")) throw new Error("Pregled nije važeći. Proverite porudžbinu ponovo.");
  const expected = createHmac("sha256", secret).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new Error("Pregled nije važeći. Proverite porudžbinu ponovo.");
  const quote = quoteSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString()));
  if (quote.actorId !== actorId || quote.expires < now) throw new Error("Pregled je istekao. Proverite porudžbinu ponovo.");
  return quote;
}
