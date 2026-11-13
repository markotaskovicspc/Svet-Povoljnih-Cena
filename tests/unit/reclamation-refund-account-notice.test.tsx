import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReclamationRefundAccountNotice } from "@/components/reclamation-refund-account-notice";
import { cleanRefundAccount, isValidDiscountPct, needsDiscountPct, needsRefundAccount } from "@/lib/reclamation-refund-details";

function renderNotice(request: string) {
  return renderToStaticMarkup(
    createElement(ReclamationRefundAccountNotice, { request }),
  );
}

describe("reclamation request notice", () => {
  it("asks which part and how many pieces for a part replacement", () => {
    const html = renderNotice("ZAMENA_DELA");
    expect(html).toContain('role="status"');
    expect(html).toContain("koji deo");
    expect(html).toContain("koliko komada");
  });

  it.each(["", "POVRACAJ_NOVCA", "UMANJENJE_CENE", "ODUSTANAK", "ZAMENA"])(
    "does not show the notice for %s",
    (request) => {
      expect(renderNotice(request)).toBe("");
    },
  );
});

describe("reclamation refund details", () => {
  it.each(["POVRACAJ_NOVCA", "ODUSTANAK", "UMANJENJE_CENE"])("asks for an account for %s", (request) => {
    expect(needsRefundAccount(request)).toBe(true);
  });

  it.each(["", "ZAMENA", "ZAMENA_DELA"])("does not ask for an account for %s", (request) => {
    expect(needsRefundAccount(request)).toBe(false);
  });

  it("asks for a discount percentage only for a price reduction", () => {
    expect(needsDiscountPct("UMANJENJE_CENE")).toBe(true);
    expect(needsDiscountPct("POVRACAJ_NOVCA")).toBe(false);
  });

  it("keeps only the digits of the account, without checking it", () => {
    expect(cleanRefundAccount("  160-123-45 ")).toBe("16012345");
    expect(cleanRefundAccount(" - ")).toBeNull();
  });

  it("allows a discount of at most 70 percent", () => {
    expect(isValidDiscountPct(70)).toBe(true);
    expect(isValidDiscountPct(71)).toBe(false);
    expect(isValidDiscountPct(0)).toBe(false);
  });
});
