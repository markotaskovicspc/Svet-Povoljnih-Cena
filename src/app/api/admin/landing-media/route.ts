import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductMediaBucket } from "@/lib/supabase/storage";

const MAX_BYTES = 6 * 1024 * 1024;
const MAX_PIXELS = 30_000_000;
const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

async function pagePrefix(value: string | null) {
  const pageId = value?.trim() ?? "";
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(pageId)) {
    throw new Error("Sačuvajte stranu pre dodavanja medija.");
  }
  const exists = await db.landingPage.findUnique({ where: { id: pageId }, select: { id: true } });
  if (!exists) throw new Error("Landing strana nije pronađena.");
  return `landing-pages/${pageId}`;
}

export async function GET(request: Request) {
  await requireAdminAction(["CONTENT"]);
  try {
    const prefix = await pagePrefix(new URL(request.url).searchParams.get("pageId"));
    const storage = createAdminClient().storage.from(getProductMediaBucket());
    const { data, error } = await storage.list(prefix, {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({
      media: (data ?? []).filter((item) => item.name && item.id).map((item) => ({
        name: item.name,
        url: storage.getPublicUrl(`${prefix}/${item.name}`).data.publicUrl,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Mediji nisu učitani." },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  await requireAdminAction(["CONTENT"]);
  try {
    const formData = await request.formData();
    const prefix = await pagePrefix(String(formData.get("pageId") ?? ""));
    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) throw new Error("Izaberite sliku.");
    if (file.size > MAX_BYTES) throw new Error("Slika ne sme biti veća od 6 MB.");
    const extension = MIME_EXTENSIONS[file.type as keyof typeof MIME_EXTENSIONS];
    if (!extension) throw new Error("Podržani formati su JPG, PNG i WebP.");
    const input = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(input, { failOn: "error", limitInputPixels: MAX_PIXELS }).metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) {
      throw new Error("Slika ima neispravne ili prevelike dimenzije.");
    }
    const safeBase = file.name
      .replace(/\.[^.]+$/, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "slika";
    const key = `${prefix}/${safeBase}-${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`;
    const storage = createAdminClient().storage.from(getProductMediaBucket());
    const { error } = await storage.upload(key, input, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false,
    });
    if (error) throw new Error(`Upload nije uspeo: ${error.message}`);
    const url = storage.getPublicUrl(key).data.publicUrl;
    if (!url) {
      await storage.remove([key]);
      throw new Error("Javni URL nije napravljen.");
    }
    return NextResponse.json({
      media: { name: key.split("/").at(-1), url, width: metadata.width, height: metadata.height },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload nije uspeo." },
      { status: 400 },
    );
  }
}
