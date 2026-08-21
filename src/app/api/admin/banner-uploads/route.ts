import { randomBytes } from "node:crypto";
import { BannerPlacement } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminAction } from "@/lib/admin";
import {
  BANNER_IMAGE_MAX_BYTES,
  BANNER_IMAGE_STAGING_PREFIX,
  getBannerStagingImageKey,
  validateBannerImageFile,
} from "@/lib/banners/image-file";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductMediaBucket } from "@/lib/supabase/storage";
import { validateSafeSvgBytes } from "@/lib/media/safe-svg";
import {
  embedSvgLinkedImages,
  SvgCompanionRequiredError,
} from "@/lib/media/embed-svg-images";

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
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    const companions = formData
      .getAll("companions")
      .filter((value): value is File => value instanceof File && value.size > 0);
    const placement = formData.get("placement");
    const variant = formData.get("variant");
    const parsed = uploadSchema.safeParse({
      filename: file instanceof File ? file.name : "",
      contentType: file instanceof File ? file.type : "",
      bytes: file instanceof File ? file.size : 0,
      placement,
      variant,
    });
    if (!parsed.success || !(file instanceof File)) {
      return noStoreJson({ error: "SVG upload nije ispravan." }, { status: 400 });
    }
    if (companions.length > 20) {
      return noStoreJson(
        { error: "Za jedan SVG možete dodati najviše 20 pratećih slika." },
        { status: 400 },
      );
    }
    const totalBytes =
      (file instanceof File ? file.size : 0) +
      companions.reduce((sum, companion) => sum + companion.size, 0);
    if (totalBytes > BANNER_IMAGE_MAX_BYTES) {
      return noStoreJson(
        { error: "SVG i prateće slike zajedno ne smeju biti veći od 8 MB." },
        { status: 400 },
      );
    }

    let extension: string;
    let bytes: Buffer;
    let embedded: string[] = [];
    try {
      extension = validateBannerImageFile(file);
      if (extension !== "svg") throw new Error("Direktan upload je namenjen SVG fajlu.");
      const sourceBytes = Buffer.from(await file.arrayBuffer());
      const prepared = embedSvgLinkedImages(
        sourceBytes,
        await Promise.all(
          companions.map(async (companion) => ({
            name: companion.name,
            bytes: new Uint8Array(await companion.arrayBuffer()),
          })),
        ),
      );
      bytes = Buffer.from(prepared.bytes);
      embedded = prepared.embedded;
      validateBannerImageFile({
        name: file.name,
        type: file.type,
        size: bytes.length,
      });
      validateSafeSvgBytes(bytes);
    } catch (error) {
      if (error instanceof SvgCompanionRequiredError) {
        return noStoreJson(
          { error: error.message, code: error.code, missing: error.missing },
          { status: 422 },
        );
      }
      return noStoreJson(
        { error: error instanceof Error ? error.message : "SVG nije ispravan." },
        { status: 400 },
      );
    }
    const key = [
      BANNER_IMAGE_STAGING_PREFIX.replace(/\/$/, ""),
      parsed.data.placement.toLowerCase(),
      admin.id,
      `${Date.now()}-${randomBytes(8).toString("hex")}-${parsed.data.variant}.${extension}`,
    ].join("/");
    const storage = createAdminClient().storage.from(getProductMediaBucket());
    const { error } = await storage.upload(key, bytes, {
      cacheControl: "3600",
      contentType: "image/svg+xml",
      upsert: false,
    });
    if (error) return noStoreJson({ error: error.message }, { status: 502 });
    const publicUrl = storage.getPublicUrl(key).data.publicUrl;
    return noStoreJson({ key, direct: true, publicUrl, embedded });
  }

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
    if (extension === "svg") {
      throw new Error("SVG se šalje kroz bezbednu direktnu proveru.");
    }
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
