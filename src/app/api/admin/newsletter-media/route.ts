import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductMediaBucket } from "@/lib/supabase/storage";
import { validateNewsletterImageFile } from "@/lib/newsletter/image-file";

export const runtime = "nodejs";

export async function POST(request: Request) {
  await requireAdminAction(["ADS"]);
  try {
    const form = await request.formData();
    const campaignId = String(form.get("campaignId") ?? "");
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(campaignId)) {
      return NextResponse.json({ error: "Kampanja nije pronađena." }, { status: 400 });
    }
    const campaign = await db.newsletterCampaign.findUnique({
      where: { id: campaignId }, select: { status: true },
    });
    if (!campaign) return NextResponse.json({ error: "Kampanja nije pronađena." }, { status: 404 });
    if (campaign.status !== "DRAFT" && campaign.status !== "IN_REVIEW") {
      return NextResponse.json({ error: "Sadržaj kampanje je zaključan. Napravite kopiju za izmene." }, { status: 409 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Izaberite sliku sa uređaja.");
    validateNewsletterImageFile(file);
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { failOn: "error", limitInputPixels: 20_000_000 });
    const metadata = await image.metadata();
    const formats: Record<string, string> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };
    if (metadata.format !== formats[file.type] || !metadata.width || !metadata.height) {
      throw new Error("Sadržaj fajla nije ispravna slika izabranog formata.");
    }
    // Email-compatible output, stripped metadata and bounded dimensions.
    const resized = image.rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true });
    const extension = metadata.hasAlpha ? "png" : "jpg";
    const bytes = await (metadata.hasAlpha ? resized.png() : resized.jpeg({ quality: 85 })).toBuffer();
    const key = `newsletter/${campaignId}/${randomUUID()}.${extension}`;
    const storage = createAdminClient().storage.from(getProductMediaBucket());
    const { error } = await storage.upload(key, bytes, {
      contentType: extension === "png" ? "image/png" : "image/jpeg",
      cacheControl: "31536000", upsert: false,
    });
    if (error) return NextResponse.json({ error: "Otpremanje slike nije uspelo. Pokušajte ponovo." }, { status: 502 });
    const url = storage.getPublicUrl(key).data.publicUrl;
    if (!url) {
      await storage.remove([key]);
      throw new Error("URL slike nije napravljen. Pokušajte ponovo.");
    }
    return NextResponse.json({ url }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Slika nije otpremljena. Izaberite ispravan JPG, PNG ili WebP do 4 MB (najviše 20 megapiksela)." }, { status: 400 });
  }
}
