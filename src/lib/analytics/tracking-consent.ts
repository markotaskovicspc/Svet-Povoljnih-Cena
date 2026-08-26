export const TRACKING_CONSENT_COOKIE = "spc_cookie_consent";
export const TRACKING_CONSENT_VERSION_COOKIE = "spc_cookie_consent_version";
export const TRACKING_CONSENT_VERSION = "2026-08-meta";

export type TrackingConsent =
  | "essential"
  | "analytics"
  | "marketing"
  | "all";

export function normalizeTrackingConsent(
  value: string | null | undefined,
): TrackingConsent | null {
  return value === "essential" ||
    value === "analytics" ||
    value === "marketing" ||
    value === "all"
    ? value
    : null;
}

export function trackingConsentFromCookieHeader(
  cookieHeader: string | null | undefined,
) {
  return normalizeTrackingConsent(
    readCookieValue(cookieHeader, TRACKING_CONSENT_COOKIE),
  );
}

export function allowsAnalytics(consent: TrackingConsent | null | undefined) {
  return consent === "analytics" || consent === "all";
}

export function allowsMarketing(consent: TrackingConsent | null | undefined) {
  return consent === "marketing" || consent === "all";
}

export function consentFromChoices(input: {
  analytics: boolean;
  marketing: boolean;
}): TrackingConsent {
  if (input.analytics && input.marketing) return "all";
  if (input.analytics) return "analytics";
  if (input.marketing) return "marketing";
  return "essential";
}

export function readCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
) {
  const prefix = `${name}=`;
  const raw = (cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
