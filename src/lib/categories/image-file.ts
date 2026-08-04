import { getManagedProductMediaStorageKey } from "@/lib/supabase/storage";

export const CATEGORY_IMAGE_PREFIX = "content/categories/";
export const CATEGORY_IMAGE_STAGING_PREFIX = `${CATEGORY_IMAGE_PREFIX}staging/`;
export const CATEGORY_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED_IMAGE_EXTENSIONS = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/avif": ["avif"],
} as const;

type CategoryImageFileMetadata = Pick<File, "name" | "size" | "type">;

export function validateCategoryImageFile(file: CategoryImageFileMetadata) {
  if (file.size <= 0) {
    throw new Error("Izaberite sliku sa uređaja.");
  }
  if (file.size > CATEGORY_IMAGE_MAX_BYTES) {
    throw new Error("Slika ne sme biti veća od 8 MB.");
  }

  const allowedExtensions = ALLOWED_IMAGE_EXTENSIONS[
    file.type as keyof typeof ALLOWED_IMAGE_EXTENSIONS
  ] as readonly string[] | undefined;
  if (!allowedExtensions) {
    throw new Error("Podržani formati slike su PNG, JPG, WebP i AVIF.");
  }

  const extension = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!extension || !allowedExtensions.includes(extension)) {
    throw new Error("Ekstenzija slike se ne poklapa sa formatom fajla.");
  }

  return extension;
}

export function getManagedCategoryImageKey(value: string | null | undefined) {
  const key = getManagedProductMediaStorageKey(value);
  return key?.startsWith(CATEGORY_IMAGE_PREFIX) &&
    !key.startsWith(CATEGORY_IMAGE_STAGING_PREFIX)
    ? key
    : null;
}

export function getCategoryStagingImageKey(
  value: string | null | undefined,
  expected: { actorId: string },
) {
  const key = value?.trim();
  if (!key?.startsWith(CATEGORY_IMAGE_STAGING_PREFIX)) return null;

  const relative = key.slice(CATEGORY_IMAGE_STAGING_PREFIX.length);
  const parts = relative.split("/");
  if (parts.length !== 2) return null;

  const [actorId, filename] = parts;
  if (actorId !== expected.actorId) return null;

  return /^\d{10,}-[a-f0-9]{16}\.(jpg|jpeg|png|webp|avif)$/.test(
    filename ?? "",
  )
    ? key
    : null;
}

export function toCategoryImageUploadBody(bytes: Uint8Array): ArrayBuffer {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
}
