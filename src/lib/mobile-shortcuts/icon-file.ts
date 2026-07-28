import { getManagedProductMediaStorageKey } from "@/lib/supabase/storage";
import { validatePictogramIconFile } from "@/lib/pictograms/icon-file";

export const MOBILE_SHORTCUT_ICON_PREFIX = "mobile-shortcuts/";

export const validateMobileShortcutIconFile = validatePictogramIconFile;

export function getManagedMobileShortcutIconKey(
  value: string | null | undefined,
) {
  const key = getManagedProductMediaStorageKey(value);
  return key?.startsWith(MOBILE_SHORTCUT_ICON_PREFIX) ? key : null;
}
