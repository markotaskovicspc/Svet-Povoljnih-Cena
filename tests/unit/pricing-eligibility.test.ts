import { describe, expect, it } from "vitest";
import { resolvePricingEligibility } from "@/components/pricing/pricing-eligibility";

describe("pricing eligibility hydration", () => {
  it("keeps the first client render identical to the server render", () => {
    expect(
      resolvePricingEligibility({
        clientReady: false,
        isCustomerLoggedIn: false,
        sessionStatus: "authenticated",
        sessionUserType: "customer",
      }),
    ).toBe(false);
  });

  it("uses the authenticated customer session after hydration", () => {
    expect(
      resolvePricingEligibility({
        clientReady: true,
        isCustomerLoggedIn: false,
        sessionStatus: "authenticated",
        sessionUserType: "customer",
      }),
    ).toBe(true);
    expect(
      resolvePricingEligibility({
        clientReady: true,
        isCustomerLoggedIn: false,
        sessionStatus: "unauthenticated",
      }),
    ).toBe(false);
  });
});
