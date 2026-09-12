import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getProductArAsset } from "@/lib/product-ar";
import { dateInputInTimeZone } from "@/lib/admin/report-period";

// Per-process global ceiling, not an IP or visitor-based limiter.
let windowStart = 0;
let requests = 0;
export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  const reject = (status: number) => new Response(null, { status, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) return reject(403);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return reject(415);
  if (Number(request.headers.get("content-length")) > 256) return reject(413);
  // Bound streamed bodies too, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return reject(400);
  let text = "", bytes = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 256) { await reader.cancel(); return reject(413); }
    text += decoder.decode(value, { stream: true });
  }
  let body: unknown;
  try { body = JSON.parse(text + decoder.decode()); } catch { return reject(400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reject(400);
  const data = body as Record<string, unknown>;
  if (Object.keys(data).length !== 2 || typeof data.slug !== "string" || typeof data.event !== "string"
    || !getProductArAsset(data.slug) || !["model_opened", "ar_clicked", "ar_qr_landed"].includes(data.event)) return reject(400);
  const now = Date.now();
  if (now - windowStart >= 60_000) { windowStart = now; requests = 0; }
  if (++requests > 1200) return reject(429);
  const day = new Date(`${dateInputInTimeZone(new Date(now))}T00:00:00Z`);
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "ProductArDailyCount" (day, slug, event, count)
    VALUES (${day}::date, ${data.slug}, ${data.event}, 1)
    ON CONFLICT (day, slug, event) DO UPDATE
    SET count = LEAST("ProductArDailyCount".count + 1, 1000000)
  `);
  return reject(204);
}
