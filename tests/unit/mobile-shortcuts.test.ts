import { describe, expect, it } from "vitest";
import {
  isExternalMobileShortcutHref,
  isMobileShortcutIconUrl,
  normalizeMobileShortcutHref,
  parseMobileShortcutDestination,
} from "@/lib/mobile-shortcuts/shared";

describe("mobile shortcut destinations", () => {
  it("parses database and custom destinations without losing URL colons", () => {
    expect(parseMobileShortcutDestination("action:action-1")).toEqual({
      kind: "action",
      value: "action-1",
    });
    expect(
      parseMobileShortcutDestination("href:https://partner.rs/ponuda?a=1"),
    ).toEqual({
      kind: "href",
      value: "https://partner.rs/ponuda?a=1",
    });
    expect(parseMobileShortcutDestination("unknown:value")).toBeNull();
    expect(parseMobileShortcutDestination("href:")).toBeNull();
  });

  it("normalizes valid storefront and external links", () => {
    expect(normalizeMobileShortcutHref("/akcija?izvor=mobile")).toBe(
      "/akcija?izvor=mobile",
    );
    expect(
      normalizeMobileShortcutHref(
        "https://www.svetpovoljnihcena.rs/heroji-meseca",
      ),
    ).toBe("/heroji-meseca");
    expect(normalizeMobileShortcutHref("https://partner.rs/ponuda")).toBe(
      "https://partner.rs/ponuda",
    );
  });

  it("rejects unsafe or non-page destinations", () => {
    expect(() => normalizeMobileShortcutHref("/admin")).toThrow(/admin/i);
    expect(() => normalizeMobileShortcutHref("/api/orders")).toThrow(/API/i);
    expect(() => normalizeMobileShortcutHref("//evil.example/path")).toThrow(
      /HTTP/i,
    );
    expect(() => normalizeMobileShortcutHref("javascript:alert(1)")).toThrow(
      /HTTP/i,
    );
    expect(() => normalizeMobileShortcutHref("#sekcija")).toThrow(/sidro/i);
  });
});

describe("mobile shortcut presentation", () => {
  it("recognizes external destinations and supported icon URLs", () => {
    expect(isExternalMobileShortcutHref("https://partner.rs")).toBe(true);
    expect(isExternalMobileShortcutHref("/akcija")).toBe(false);
    expect(isMobileShortcutIconUrl("/brand/akcija.svg")).toBe(true);
    expect(
      isMobileShortcutIconUrl(
        "https://x.supabase.co/storage/v1/object/public/product-media/icon",
      ),
    ).toBe(true);
    expect(isMobileShortcutIconUrl("Sparkles")).toBe(false);
  });
});
