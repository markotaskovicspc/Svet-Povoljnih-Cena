import { describe, expect, it } from "vitest";
import {
  allowsAnalytics,
  allowsMarketing,
  consentFromChoices,
  normalizeTrackingConsent,
  readCookieValue,
  trackingConsentFromCookieHeader,
} from "@/lib/analytics/tracking-consent";

describe("tracking consent", () => {
  it("keeps legacy analytics consent without silently granting marketing", () => {
    const consent = trackingConsentFromCookieHeader(
      "session=abc; spc_cookie_consent=analytics",
    );

    expect(allowsAnalytics(consent)).toBe(true);
    expect(allowsMarketing(consent)).toBe(false);
  });

  it("supports independent and combined optional categories", () => {
    expect(consentFromChoices({ analytics: false, marketing: false })).toBe(
      "essential",
    );
    expect(consentFromChoices({ analytics: true, marketing: false })).toBe(
      "analytics",
    );
    expect(consentFromChoices({ analytics: false, marketing: true })).toBe(
      "marketing",
    );
    expect(consentFromChoices({ analytics: true, marketing: true })).toBe(
      "all",
    );
    expect(allowsAnalytics("all")).toBe(true);
    expect(allowsMarketing("all")).toBe(true);
  });

  it("rejects unknown values and safely reads encoded cookie values", () => {
    expect(normalizeTrackingConsent("yes")).toBeNull();
    expect(readCookieValue("_fbc=fb.1.123%3Aabc", "_fbc")).toBe(
      "fb.1.123:abc",
    );
  });
});
