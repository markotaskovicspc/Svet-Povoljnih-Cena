import { randomBytes } from "node:crypto";
import { BannerPlacement } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminAction } from "@/lib/admin";
import {
  BANNER_IMAGE_STAGING_PREFIX,
  getBannerStagingImageKey,
  validateBannerImageFile,
} from "@/lib/banners/image-file";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductMediaBucket } from "@/lib/supabase/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  bytes: z.number().int().positive(),
  placement: z.nativeEnum(BannerPlacement),
  variant: z.enum(["desktop", "mobile"]),
});

const cleanupSchema = z.object({
  key: z.string().min(1).max(600),
  placement: z.nativeEnum(BannerPlacement),
  variant: z.enum(["desktop", "mobile"]),
});

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export async function POST(request: Request) {
  const admin = await requireAdminAction(["CONTENT"]);
  const input = uploadSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return noStoreJson(
      { error: input.error.issues[0]?.message ?? "Slika nije ispravna." },
      { status: 400 },
    );
  }

  let extension: string;
  try {
    extension = validateBannerImageFile({
      name: input.data.filename,
      type: input.data.contentType,
      size: input.data.bytes,
    });
  } catch (error) {
    return noStoreJson(
      {
        error: error instanceof Error ? error.message : "Slika nije ispravna.",
      },
      { status: 400 },
    );
  }

  const key = [
    BANNER_IMAGE_STAGING_PREFIX.replace(/\/$/, ""),
    input.data.placement.toLowerCase(),
    admin.id,
    `${Date.now()}-${randomBytes(8).toString("hex")}-${input.data.variant}.${extension}`,
  ].join("/");
  const storage = createAdminClient().storage.from(getProductMediaBucket());
  const { data, error } = await storage.createSignedUploadUrl(key);
  if (error || !data?.signedUrl) {
    return noStoreJson(
      { error: error?.message ?? "Upload slike trenutno nije dostupan." },
      { status: 503 },
    );
  }

  return noStoreJson({
    key,
    uploadUrl: data.signedUrl,
  });
}

export async function DELETE(request: Request) {
  const admin = await requireAdminAction(["CONTENT"]);
  const input = cleanupSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return noStoreJson({ error: "Neispravan upload ključ." }, { status: 400 });
  }

  const key = getBannerStagingImageKey(input.data.key, {
    actorId: admin.id,
    placement: input.data.placement,
    variant: input.data.variant,
  });
  if (!key) {
    return noStoreJson(
      { error: "Upload ključ nije dozvoljen." },
      { status: 403 },
    );
  }

  const { error } = await createAdminClient()
    .storage.from(getProductMediaBucket())
    .remove([key]);
  if (error) {
    return noStoreJson({ error: error.message }, { status: 502 });
  }
  return noStoreJson({ ok: true });
}
