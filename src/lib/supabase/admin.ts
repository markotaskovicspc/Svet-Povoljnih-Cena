import "server-only";

import { createClient } from "@supabase/supabase-js";
import { envValue } from "@/lib/env";

let cachedAdminClient: ReturnType<typeof createClient> | null = null;

function getAdminSupabaseEnv() {
  const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = envValue("SUPABASE_SERVICE_ROLE_KEY");

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  }
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  return { url, serviceRoleKey };
}

export function createAdminClient() {
  if (cachedAdminClient) return cachedAdminClient;

  const { url, serviceRoleKey } = getAdminSupabaseEnv();
  cachedAdminClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedAdminClient;
}
