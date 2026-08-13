import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { IdentityStep } from "@/components/checkout/identity-step";
import { getCheckoutPaymentTrustMessage } from "@/components/checkout/notes-consent";
import { NewsletterBand } from "@/components/layout/newsletter-band";
import {
  isCodeLikeSearchQuery,
  normalizeSearchTerm,
} from "@/lib/api/search";
import { missingXExpressStreetDeactivation } from "@/lib/x-express/sync";

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

describe("pre-launch UI regressions", () => {
  it("does not advertise the incomplete SMS OTP flow", () => {
    const html = renderToStaticMarkup(
      <IdentityStep value="login" onPick={() => undefined} />,
    );

    expect(html).toContain("E-pošta i lozinka");
    expect(html).toContain("/nalog/prijava?callbackUrl=%2Fcheckout%2Fpodaci");
    expect(html).not.toContain("SMS kod");
  });

  it("describes only the selected payment transport", () => {
    expect(getCheckoutPaymentTrustMessage("pouzece_gotovina")).toContain(
      "prilikom preuzimanja",
    );
    expect(getCheckoutPaymentTrustMessage("pouzece_gotovina")).not.toMatch(
      /IPS|3-D Secure/,
    );
    expect(getCheckoutPaymentTrustMessage("ips")).toContain("IPS Skeniraj");
    expect(getCheckoutPaymentTrustMessage("kartica")).toContain("3-D Secure");
  });

  it("keeps the newsletter form inert until React attaches its submit handler", () => {
    const html = renderToStaticMarkup(<NewsletterBand />);
    expect(html).toMatch(/<input[^>]+disabled=""/);
    expect(html).toMatch(/<button[^>]+type="submit"[^>]*disabled=""/);
  });

  it("normalizes punctuation in product-name search terms", () => {
    expect(normalizeSearchTerm("SMD-LED")).toBe("smdled");
    expect(normalizeSearchTerm("  SMD LED  ")).toBe("smdled");
    expect(isCodeLikeSearchQuery("SMD")).toBe(true);
    expect(isCodeLikeSearchQuery("smd")).toBe(true);
  });

  it("passes large street dictionaries as one de-duplicated array parameter", () => {
    const ids = Array.from({ length: 40_000 }, (_, index) => index + 1);
    const query = missingXExpressStreetDeactivation([...ids, 1, 2]);

    expect(query?.ids).toHaveLength(40_000);
    expect(query?.sql).toContain("ANY($1::integer[])");
    expect(query?.sql).not.toContain("NOT IN");
    expect(missingXExpressStreetDeactivation([])).toBeNull();
  });
});
