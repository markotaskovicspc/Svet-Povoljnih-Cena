import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReclamationRefundAccountNotice } from "@/components/reclamation-refund-account-notice";
import { needsDiscountPct, needsRefundAccount, normalizeRefundAccount } from "@/lib/reclamation-refund-details";

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

  it("rejects accounts with a wrong length or check digits", () => {
    expect(normalizeRefundAccount("160-123-45")).toBeNull();
    expect(normalizeRefundAccount("160000000000000000")).toBeNull();
  });
});
