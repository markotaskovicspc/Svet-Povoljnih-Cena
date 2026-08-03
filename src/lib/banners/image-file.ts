import { getManagedProductMediaStorageKey } from "@/lib/supabase/storage";

export const BANNER_IMAGE_PREFIX = "content/banners/";
export const BANNER_IMAGE_STAGING_PREFIX = `${BANNER_IMAGE_PREFIX}staging/`;
export const BANNER_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export type BannerImageVariant = "desktop" | "mobile";

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

export function getManagedBannerImageKey(value: string | null | undefined) {
  const key = getManagedProductMediaStorageKey(value);
  return key?.startsWith(BANNER_IMAGE_PREFIX) ? key : null;
}

/**
 * Accept only a temporary upload created for this exact admin, placement and
 * image variant. The Server Action receives this small key instead of the
 * original image bytes, keeping banner saves below Vercel's request limit.
 */
export function getBannerStagingImageKey(
  value: string | null | undefined,
  expected: {
    actorId: string;
    placement: string;
    variant: BannerImageVariant;
  },
) {
  const key = value?.trim();
  if (!key?.startsWith(BANNER_IMAGE_STAGING_PREFIX)) return null;

  const relative = key.slice(BANNER_IMAGE_STAGING_PREFIX.length);
  const parts = relative.split("/");
  if (parts.length !== 3) return null;

  const [placement, actorId, filename] = parts;
  if (
    placement !== expected.placement.toLowerCase() ||
    actorId !== expected.actorId
  ) {
    return null;
  }

  const match = filename?.match(
    /^(\d{10,})-([a-f0-9]{16})-(desktop|mobile)\.(jpg|jpeg|png|webp|avif)$/,
  );
  return match?.[3] === expected.variant ? key : null;
}

/**
 * Copy image bytes into a standalone ArrayBuffer before handing them to fetch.
 * Node Buffers are Uint8Array subclasses, but treating them as a string at any
 * transport boundary replaces non-UTF-8 bytes and silently corrupts images.
 */
export function toBannerImageUploadBody(bytes: Uint8Array): ArrayBuffer {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
}
