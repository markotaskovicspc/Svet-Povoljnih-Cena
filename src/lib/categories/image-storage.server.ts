import "server-only";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { db } from "@/lib/db";
import { logOperationalError } from "@/lib/monitoring";
import {
  CATEGORY_IMAGE_PREFIX,
  getCategoryStagingImageKey,
  getManagedCategoryImageKey,
  toCategoryImageUploadBody,
  validateCategoryImageFile,
} from "@/lib/categories/image-file";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductMediaBucket } from "@/lib/supabase/storage";

async function persistCategoryImage(input: Buffer) {
  let output: Buffer;
  try {
    const metadata = await sharp(input, {
      failOn: "warning",
      limitInputPixels: 80_000_000,
    }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Nedostaju dimenzije slike.");
    }
    output = await sharp(input, {
      failOn: "warning",
      limitInputPixels: 80_000_000,
    })
      .rotate()
      .resize({
        width: 1800,
        height: 1800,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 88, effort: 4 })
      .toBuffer();
  } catch {
    throw new Error(
      "Fajl nije čitljiva slika. Izaberite ispravan PNG, JPG, WebP ili AVIF.",
    );
  }

  const key = `${CATEGORY_IMAGE_PREFIX}${Date.now()}-${randomBytes(8).toString("hex")}.webp`;
  const storage = createAdminClient().storage.from(getProductMediaBucket());
  const { error } = await storage.upload(
    key,
    toCategoryImageUploadBody(output),
    {
      cacheControl: "31536000",
      contentType: "image/webp",
      upsert: false,
    },
  );
  if (error) throw new Error(`Upload slike nije uspeo: ${error.message}`);

  const { data: storedObject, error: verificationError } =
    await storage.download(key);
  const storedBytes = storedObject
    ? Buffer.from(await storedObject.arrayBuffer())
    : null;
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

export async function uploadStagedCategoryImage(
  value: string,
  actorId: string,
) {
  const key = getCategoryStagingImageKey(value, { actorId });
  if (!key) throw new Error("Privremeni upload slike nije ispravan.");

  const storage = createAdminClient().storage.from(getProductMediaBucket());
  try {
    const { data, error } = await storage.download(key);
    if (error || !data) {
      throw new Error(error?.message ?? "Otpremljena slika nije pronađena.");
    }
    validateCategoryImageFile({ name: key, size: data.size, type: data.type });
    return await persistCategoryImage(Buffer.from(await data.arrayBuffer()));
  } finally {
    const { error } = await storage.remove([key]);
    if (error) {
      logOperationalError("category.staging_cleanup_failed", error, {
        actorId,
        key,
      });
    }
  }
}

export async function removeManagedCategoryImages(
  values: Array<string | null | undefined>,
  context: Record<string, unknown>,
) {
  const keys = Array.from(
    new Set(
      values
        .map(getManagedCategoryImageKey)
        .filter((key): key is string => Boolean(key)),
    ),
  );
  if (!keys.length) return;

  const { error } = await createAdminClient()
    .storage.from(getProductMediaBucket())
    .remove(keys);
  if (error) {
    logOperationalError("category.image_cleanup_failed", error, {
      ...context,
      keys,
    });
  }
}

export async function removeUnreferencedCategoryImages(
  values: Array<string | null | undefined>,
  context: Record<string, unknown>,
) {
  try {
    const urls = Array.from(
      new Set(values.filter((value): value is string => Boolean(value))),
    );
    const removable: string[] = [];
    for (const url of urls) {
      if (!getManagedCategoryImageKey(url)) continue;
      const references = await db.category.count({ where: { imageUrl: url } });
      if (references === 0) removable.push(url);
    }
    await removeManagedCategoryImages(removable, context);
  } catch (error) {
    logOperationalError("category.image_reference_check_failed", error, {
      ...context,
      values,
    });
  }
}
