import { normalizeStorefrontHref } from "@/lib/storefront/href";

export const MOBILE_SHORTCUT_COUNT = 4;

export type MobileShortcutDestinationKind = "action" | "landing" | "href";

export type ParsedMobileShortcutDestination = {
  kind: MobileShortcutDestinationKind;
  value: string;
};

export function parseMobileShortcutDestination(
  value: string | null | undefined,
): ParsedMobileShortcutDestination | null {
  const clean = value?.trim();
  if (!clean) return null;
  const separator = clean.indexOf(":");
  if (separator < 1) return null;
  const kind = clean.slice(0, separator);
  const destination = clean.slice(separator + 1).trim();
  if (
    !destination ||
    (kind !== "action" && kind !== "landing" && kind !== "href")
  ) {
    return null;
  }
  return { kind, value: destination };
}

export function normalizeMobileShortcutHref(value: string) {
  const normalized = normalizeStorefrontHref(value)?.trim();
  if (!normalized) throw new Error("Odredište je obavezno.");
  if (normalized.startsWith("#")) {
    throw new Error("Mobilni prečac mora da vodi na stranicu, ne samo na sidro.");
  }
  if (normalized.startsWith("/")) {
    if (normalized.startsWith("//")) {
      throw new Error("Link sa spoljnim domenom mora imati HTTP(S) protokol.");
    }
    if (
      /^\/admin(?:\/|$)/.test(normalized) ||
      /^\/api(?:\/|$)/.test(normalized)
    ) {
      throw new Error("Mobilni prečac ne sme da vodi u admin ili API.");
    }
    return normalized;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Link mora biti interna putanja ili pun HTTP(S) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Dozvoljeni su samo HTTP(S) linkovi.");
  }
  return parsed.toString();
}

export function isExternalMobileShortcutHref(value: string) {
  return /^https?:\/\//i.test(value);
}

export function isMobileShortcutIconUrl(value: string | null | undefined) {
  const clean = value?.trim();
  if (!clean) return false;
  if (!(clean.startsWith("/") || /^https?:\/\//i.test(clean))) return false;
  return (
    /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(clean) ||
    clean.includes("/storage/v1/object/public/")
  );
}
