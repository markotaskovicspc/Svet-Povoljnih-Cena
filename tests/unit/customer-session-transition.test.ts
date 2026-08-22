import { describe, expect, it } from "vitest";

import { shouldRefreshCustomerSession } from "@/lib/auth/customer-session-transition";

describe("customer auth session transitions", () => {
  it("refreshes after login returns to the cart", () => {
    expect(
      shouldRefreshCustomerSession("/nalog/prijava", "/korpa"),
    ).toBe(true);
  });

  it("refreshes after registration returns to the cart", () => {
    expect(
      shouldRefreshCustomerSession("/nalog/registracija", "/korpa"),
    ).toBe(true);
  });

  it("refreshes after account logout", () => {
    expect(
      shouldRefreshCustomerSession("/nalog", "/nalog/prijava"),
    ).toBe(true);
  });

  it("does not refetch the session during regular storefront navigation", () => {
    expect(shouldRefreshCustomerSession("/korpa", "/novo")).toBe(false);
    expect(shouldRefreshCustomerSession("/korpa", "/korpa")).toBe(false);
  });
});
