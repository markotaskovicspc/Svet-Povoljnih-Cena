import { afterEach, describe, expect, it } from "vitest";
import {
  isProductAvailableOnWeb,
  isWebAutoAvailabilityEnforced,
  webStorefrontProductWhere,
} from "@/lib/web-storefront-availability";

const original = process.env.ENFORCE_WEB_AUTO_AVAILABILITY;

afterEach(() => {
  if (original === undefined) {
    delete process.env.ENFORCE_WEB_AUTO_AVAILABILITY;
  } else {
    process.env.ENFORCE_WEB_AUTO_AVAILABILITY = original;
  }
});

describe("web storefront availability rollout", () => {
  it("uses the manual Web check while DC availability enforcement is disabled", () => {
    delete process.env.ENFORCE_WEB_AUTO_AVAILABILITY;

    expect(isWebAutoAvailabilityEnforced()).toBe(false);
    expect(webStorefrontProductWhere()).toEqual({
      isActive: true,
      availableWebManual: true,
    });
    expect(
      isProductAvailableOnWeb({
        isActive: true,
        availableWebManual: true,
        availableWebAuto: false,
      }),
    ).toBe(true);
  });

  it("always honors an administrator turning the Web check off", () => {
    process.env.ENFORCE_WEB_AUTO_AVAILABILITY = "false";

    expect(
      isProductAvailableOnWeb({
        isActive: true,
        availableWebManual: false,
        availableWebAuto: true,
      }),
    ).toBe(false);
  });

  it("requires automatic DC availability when strict enforcement is enabled", () => {
    process.env.ENFORCE_WEB_AUTO_AVAILABILITY = "true";

    expect(isWebAutoAvailabilityEnforced()).toBe(true);
    expect(webStorefrontProductWhere()).toEqual({
      isActive: true,
      availableWebManual: true,
      availableWebAuto: true,
    });
    expect(
      isProductAvailableOnWeb({
        isActive: true,
        availableWebManual: true,
        availableWebAuto: false,
      }),
    ).toBe(false);
  });
});
