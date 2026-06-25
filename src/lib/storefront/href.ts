import { BRAND } from "@/lib/brand";

function normalizedHost(value: string) {
  return value.toLowerCase().replace(/^www\./, "");
}

function hostFromUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

const INTERNAL_HOSTS = new Set(
  [
    BRAND.domain,
    hostFromUrl(BRAND.url),
    hostFromUrl(process.env.NEXT_PUBLIC_BASE_URL),
    hostFromUrl(process.env.NEXTAUTH_URL),
  ]
    .filter((host): host is string => Boolean(host))
    .map(normalizedHost),
);

export function normalizeStorefrontHref(value: string | null | undefined) {
  const href = value?.trim();
  if (!href) return undefined;
  if (href.startsWith("/") || href.startsWith("#")) return href;

  try {
    const parsed = new URL(href);
    const host = normalizedHost(parsed.hostname);
    if (INTERNAL_HOSTS.has(host) || host.endsWith(".vercel.app")) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
    }
  } catch {
    return href;
  }

  return href;
}
