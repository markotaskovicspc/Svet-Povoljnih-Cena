import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getProductMediaBucket } from "@/lib/supabase/storage";

export async function deleteManagedRabaluxMedia(keys: string[]) {
  const safeKeys = Array.from(
    new Set(
      keys
        .map((key) => key.trim().replace(/^\/+/, ""))
        .filter(Boolean),
    ),
  );
  if (!safeKeys.length || safeKeys.length > 100) {
    throw new Error("Rabalux media delete batch must contain 1-100 keys.");
  }
  if (safeKeys.some((key) => key.includes("..") || key.length > 500)) {
    throw new Error("Rabalux media delete batch contains an unsafe storage key.");
  }
  const { error } = await createAdminClient()
    .storage.from(getProductMediaBucket())
    .remove(safeKeys);
  if (error) {
    throw new Error(`Rabalux media deletion failed: ${error.message}`);
  }
  return { deleted: safeKeys.length };
}
