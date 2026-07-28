import { getManagedProductMediaStorageKey } from "@/lib/supabase/storage";

export const BANNER_IMAGE_PREFIX = "content/banners/";
export const BANNER_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED_IMAGE_EXTENSIONS = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/avif": ["avif"],
} as const;

type BannerImageFileMetadata = Pick<File, "name" | "size" | "type">;

export function validateBannerImageFile(file: BannerImageFileMetadata) {
  if (file.size <= 0) {
    throw new Error("Izaberite sliku sa računara.");
  }
  if (file.size > BANNER_IMAGE_MAX_BYTES) {
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

export function getManagedBannerImageKey(
  value: string | null | undefined,
) {
  const key = getManagedProductMediaStorageKey(value);
  return key?.startsWith(BANNER_IMAGE_PREFIX) ? key : null;
}
