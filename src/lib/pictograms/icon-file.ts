import { getManagedProductMediaStorageKey } from "@/lib/supabase/storage";

export const PICTOGRAM_ICON_PREFIX = "pictograms/";
export const PICTOGRAM_ICON_MAX_BYTES = 750 * 1024;

const ALLOWED_ICON_EXTENSIONS = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
} as const;

type PictogramIconFileMetadata = Pick<File, "name" | "size" | "type">;

export function validatePictogramIconFile(file: PictogramIconFileMetadata) {
  if (file.size <= 0) {
    throw new Error("Izaberite ikonu za upload.");
  }
  if (file.size > PICTOGRAM_ICON_MAX_BYTES) {
    throw new Error("Ikona ne sme biti veća od 750 KB.");
  }

  const allowedExtensions = ALLOWED_ICON_EXTENSIONS[
    file.type as keyof typeof ALLOWED_ICON_EXTENSIONS
  ] as readonly string[] | undefined;
  if (!allowedExtensions) {
    throw new Error("Podržani formati ikone su PNG, JPG i WebP.");
  }

  const extension = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!extension || !allowedExtensions.includes(extension)) {
    throw new Error("Ekstenzija ikone se ne poklapa sa formatom fajla.");
  }

  return extension;
}

export function getManagedPictogramIconKey(value: string | null | undefined) {
  const key = getManagedProductMediaStorageKey(value);
  return key?.startsWith(PICTOGRAM_ICON_PREFIX) ? key : null;
}
