import { describe, expect, it } from "vitest";
import {
  customerCallback,
  customerLoginHref,
} from "@/lib/auth/customer-callback";

describe("customer auth return path", () => {
  it("returns a cart login to the cart", () => {
    expect(customerLoginHref("/korpa")).toBe(
      "/nalog/prijava?callbackUrl=%2Fkorpa",
    );
  });

  it("preserves another safe storefront path", () => {
    expect(customerLoginHref("/p/trosed-relaxo")).toBe(
      "/nalog/prijava?callbackUrl=%2Fp%2Ftrosed-relaxo",
    );
  });

  it("keeps unsafe and recursive callbacks inside the customer account", () => {
    expect(customerCallback("https://example.com/steal-session")).toBe(
      "/nalog",
    );
    expect(customerCallback("//example.com/steal-session")).toBe("/nalog");
    expect(customerLoginHref("/admin")).toBe(
      "/nalog/prijava?callbackUrl=%2Fnalog",
    );
    expect(customerLoginHref("/nalog/prijava?callbackUrl=%2Fkorpa")).toBe(
      "/nalog/prijava?callbackUrl=%2Fnalog",
    );
  });
});
