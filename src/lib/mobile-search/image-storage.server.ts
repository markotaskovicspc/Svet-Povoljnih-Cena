import "server-only";

import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { logOperationalError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductMediaBucket } from "@/lib/supabase/storage";
import {
  getManagedMobileSearchImageKey,
  MOBILE_SEARCH_IMAGE_PREFIX,
  toMobileSearchImageUploadBody,
  validateMobileSearchImageFile,
} from "@/lib/mobile-search/image-file";

export async function uploadMobileSearchImage(file: File) {
  validateMobileSearchImageFile(file);
  const input = Buffer.from(await file.arrayBuffer());
  let output: Buffer;
  try {
    const metadata = await sharp(input, {
      failOn: "warning",
      limitInputPixels: 80_000_000,
    }).metadata();
    if (!metadata.width || !metadata.height) throw new Error("Nedostaju dimenzije slike.");
    output = await sharp(input, {
      failOn: "warning",
      limitInputPixels: 80_000_000,
    })
      .rotate()
      .resize({ width: 640, height: 480, fit: "cover", position: "attention" })
      .webp({ quality: 88, effort: 4 })
      .toBuffer();
  } catch {
    throw new Error("Fajl nije čitljiva slika. Izaberite ispravan PNG, JPG, WebP ili AVIF.");
  }

  const key = `${MOBILE_SEARCH_IMAGE_PREFIX}${Date.now()}-${randomBytes(8).toString("hex")}.webp`;
  const storage = createAdminClient().storage.from(getProductMediaBucket());
  const { error } = await storage.upload(key, toMobileSearchImageUploadBody(output), {
    cacheControl: "31536000",
    contentType: "image/webp",
    upsert: false,
  });
  if (error) throw new Error(`Upload slike nije uspeo: ${error.message}`);

  const { data: storedObject, error: verificationError } = await storage.download(key);
  const storedBytes = storedObject ? Buffer.from(await storedObject.arrayBuffer()) : null;
  if (
    verificationError ||
    !storedBytes ||
    storedBytes.length !== output.length ||
    !storedBytes.equals(output)
  ) {
    await storage.remove([key]);
    throw new Error("Upload slike nije moguće potvrditi. Pokušajte ponovo.");
  }
  const { data } = storage.getPublicUrl(key);
  if (!data.publicUrl) {
    await storage.remove([key]);
    throw new Error("Javni URL otpremljene slike nije moguće napraviti.");
  }
  return { key, url: data.publicUrl };
}

export async function removeMobileSearchImages(
  values: Array<string | null | undefined>,
  context: Record<string, unknown>,
) {
  const keys = Array.from(
    new Set(values.map(getManagedMobileSearchImageKey).filter((key): key is string => Boolean(key))),
  );
  if (!keys.length) return;
  const { error } = await createAdminClient().storage.from(getProductMediaBucket()).remove(keys);
  if (error) {
    logOperationalError("mobile_search.image_cleanup_failed", error, { ...context, keys });
  }
}
