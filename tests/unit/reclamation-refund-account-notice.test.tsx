import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReclamationRefundAccountNotice } from "@/components/reclamation-refund-account-notice";

function renderNotice(request: string) {
  return renderToStaticMarkup(
    createElement(ReclamationRefundAccountNotice, { request }),
  );
}

describe("reclamation refund account notice", () => {
  it.each(["POVRACAJ_NOVCA", "UMANJENJE_CENE", "ODUSTANAK"])(
    "asks for a bank account when the customer chooses %s",
    (request) => {
      const html = renderNotice(request);

      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain("broj računa za uplatu");
      expect(html).toContain("Komentar / opis problema");
    },
  );

  it("asks for the requested discount amount", () => {
    expect(renderNotice("UMANJENJE_CENE")).toContain("iznos umanjenja");
  });

  it("asks which part and how many pieces for a part replacement", () => {
    expect(renderNotice("ZAMENA_DELA")).toContain("koji deo");
  });

  it.each(["", "POPRAVKA", "ZAMENA"])(
    "does not show the notice for %s",
    (request) => {
      expect(renderNotice(request)).toBe("");
    },
  );
});
