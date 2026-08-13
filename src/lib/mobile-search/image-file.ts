import { getManagedProductMediaStorageKey } from "@/lib/supabase/storage";

export const MOBILE_SEARCH_IMAGE_PREFIX = "content/mobile-search/";
export const MOBILE_SEARCH_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED_IMAGE_EXTENSIONS = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/avif": ["avif"],
} as const;

type ImageFileMetadata = Pick<File, "name" | "size" | "type">;

export function validateMobileSearchImageFile(file: ImageFileMetadata) {
  if (file.size <= 0) throw new Error("Izaberite sliku sa uređaja.");
  if (file.size > MOBILE_SEARCH_IMAGE_MAX_BYTES) {
    throw new Error("Slika ne sme biti veća od 8 MB.");
  }
  const extensions = ALLOWED_IMAGE_EXTENSIONS[
    file.type as keyof typeof ALLOWED_IMAGE_EXTENSIONS
  ] as readonly string[] | undefined;
  if (!extensions) {
    throw new Error("Podržani formati slike su PNG, JPG, WebP i AVIF.");
  }
  const extension = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!extension || !extensions.includes(extension)) {
    throw new Error("Ekstenzija slike se ne poklapa sa formatom fajla.");
  }
}

export function getManagedMobileSearchImageKey(value: string | null | undefined) {
  const key = getManagedProductMediaStorageKey(value);
  return key?.startsWith(MOBILE_SEARCH_IMAGE_PREFIX) ? key : null;
}

export function toMobileSearchImageUploadBody(bytes: Uint8Array): ArrayBuffer {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
}
