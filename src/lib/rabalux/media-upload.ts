export function directStorageOrigin(supabaseUrl: string) {
  const url = new URL(supabaseUrl);
  if (url.hostname.endsWith(".supabase.co")) {
    url.hostname = `${url.hostname.slice(0, -".supabase.co".length)}.storage.supabase.co`;
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.origin;
}
