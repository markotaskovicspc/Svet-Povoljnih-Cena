import { describe, expect, it } from "vitest";
import {
  normalizeWebCustomerEmail,
  normalizeWebCustomerPhone,
  webCustomerIdentity,
  webGuestCustomerId,
  webUserCustomerId,
} from "@/lib/customer-master-identity";

describe("web customer identity", () => {
  it("normalizes email first and falls back to phone", () => {
    expect(normalizeWebCustomerEmail("  KUPAC@Example.COM ")).toBe(
      "kupac@example.com",
    );
    expect(normalizeWebCustomerPhone("+381 (60) 123-4567")).toBe(
      "+381601234567",
    );
    expect(
      webCustomerIdentity({
        email: " KUPAC@Example.COM ",
        phone: "+381 60 123 4567",
      }),
    ).toBe("kupac@example.com");
    expect(webCustomerIdentity({ phone: "060/123-4567" })).toBe(
      "0601234567",
    );
  });

  it("matches the deterministic IDs used by the SQL backfill", () => {
    expect(webGuestCustomerId("integration@example.test")).toBe(
      "erp-customer-guest-56f1243d767ad140316e6c933fe35500",
    );
    expect(webUserCustomerId("customer-user-1")).toBe(
      "erp-customer-user-b9f2e79fb25a819be18091af47053742",
    );
  });
});
