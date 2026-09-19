import sharp from "sharp";
import { isOptimizableIconKey } from "@/lib/media/optimized-icon";

export const runtime = "nodejs";
const MAX_BYTES = 8 * 1024 * 1024;
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!isOptimizableIconKey(key)) return new Response("Invalid icon", { status: 400 });
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(base)) return new Response("Storage unavailable", { status: 503 });
  const source = `${base.replace(/\/$/, "")}/storage/v1/object/public/product-media/${key.split("/").map(encodeURIComponent).join("/")}`;
  try {
    const response = await fetch(source, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return new Response("Icon unavailable", { status: response.status === 404 ? 404 : 502 });
    if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Oversized icon");
    const reader = response.body?.getReader(); if (!reader) throw new Error("Empty icon");
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.length;
        if (length > MAX_BYTES) { await reader.cancel(); throw new Error("Oversized icon"); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const input = Buffer.concat(chunks);
    const image = sharp(input, { limitInputPixels: 20_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["png", "jpeg", "webp", "avif", "heif"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) throw new Error("Unsupported icon");
    const output = await image.rotate().resize(256, 256, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer();
    return new Response(new Uint8Array(output), { headers: {
      "Content-Type": "image/webp", "Content-Length": String(output.length),
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable", "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    // A transient optimization failure must not hide an existing public icon.
    return new Response(null, { status: 307, headers: { Location: source, "Cache-Control": "no-store" } });
  }
}
