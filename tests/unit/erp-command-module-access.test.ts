import { describe, expect, it } from "vitest";
import { isErpCommandBoundToModule } from "@/lib/admin/erp-command-module-access";

describe("generic ERP command module boundary", () => {
  it.each(["supplier.create", "price-list.create", "loyalty.create", "linear-promotion.create", "partner-client.create", "landing.create", "newsletter.create"])("rejects %s through an allowed article route", action => {
    expect(isErpCommandBoundToModule("artikli", action)).toBe(false);
  });
  it.each([
    ["artikli", "article.create"], ["nabavne-cene", "purchase-price.create"], ["partner-klijenti", "partner-client.create"],
    ["cenovnici", "price-list.create"], ["ulazne-fakture", "invoice.post"], ["porudzbenice", "po.send"],
  ])("preserves the intended %s / %s command", (module, action) => {
    expect(isErpCommandBoundToModule(module, action)).toBe(true);
  });
  it("does not allow common delete commands or unknown/prototype names across unrelated modules", () => {
    expect(isErpCommandBoundToModule("artikli", "row.delete")).toBe(true);
    expect(isErpCommandBoundToModule("loyalty", "row.delete")).toBe(false);
    expect(isErpCommandBoundToModule("unknown", "article.create")).toBe(false);
    expect(isErpCommandBoundToModule("artikli", "toString")).toBe(false);
  });
});
