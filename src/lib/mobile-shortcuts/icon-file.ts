import { getManagedProductMediaStorageKey } from "@/lib/supabase/storage";
import { validateSafeSvgBytes } from "@/lib/media/safe-svg";
import { validatePictogramIconFile } from "@/lib/pictograms/icon-file";

export const MOBILE_SHORTCUT_ICON_PREFIX = "mobile-shortcuts/";

export const validateMobileShortcutIconFile = validatePictogramIconFile;

export function validateMobileShortcutIconUpload(
  file: Pick<File, "name" | "size" | "type">,
  bytes: ArrayBuffer | Uint8Array,
) {
  const extension = validateMobileShortcutIconFile(file);
  if (extension === "svg") validateSafeSvgBytes(bytes);
  return extension;
}

export function getManagedMobileShortcutIconKey(
  value: string | null | undefined,
) {
  const key = getManagedProductMediaStorageKey(value);
  return key?.startsWith(MOBILE_SHORTCUT_ICON_PREFIX) ? key : null;
}
