import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IdentityStep } from "@/components/checkout/identity-step";
import { getCheckoutPaymentTrustMessage } from "@/components/checkout/notes-consent";
import { NewsletterBand } from "@/components/layout/newsletter-band";
import {
  isCodeLikeSearchQuery,
  normalizeSearchTerm,
} from "@/lib/api/search";
import { missingXExpressStreetDeactivation } from "@/lib/x-express/sync";

describe("pre-launch UI regressions", () => {
  it("keeps every checkout login method inside the identity step", () => {
    const authAction = async () => undefined;
    const html = renderToStaticMarkup(
      <IdentityStep
        value="login"
        onPick={() => undefined}
        loginAction={authAction}
        registrationAction={authAction}
        socialProviders={[
          { id: "google", label: "Google", action: authAction },
          { id: "apple", label: "Apple", action: authAction },
          { id: "facebook", label: "Facebook", action: authAction },
        ]}
      />,
    );

    expect(html).toContain("ili nastavite e-poštom");
    expect(html).toContain('name="password"');
    expect(html).toContain('name="authSurface" value="checkout"');
    expect(html).toContain('name="callbackUrl" value="/checkout/podaci"');
    expect(html).toContain("Prijavite se uz Google");
    expect(html).toContain("Prijavite se uz Apple");
    expect(html).toContain("Prijavite se uz Facebook");
    expect(html).not.toContain("/nalog/prijava?callbackUrl=");
    expect(html).not.toContain("SMS kod");
  });

  it("keeps checkout registration inline and returns to checkout", () => {
    const authAction = async () => undefined;
    const html = renderToStaticMarkup(
      <IdentityStep
        value="register"
        onPick={() => undefined}
        loginAction={authAction}
        registrationAction={authAction}
        socialProviders={[
          { id: "google", label: "Google", action: authAction },
          { id: "apple", label: "Apple", action: authAction },
          { id: "facebook", label: "Facebook", action: authAction },
        ]}
      />,
    );

    expect(html).toContain('name="authSurface" value="checkout"');
    expect(html).toContain('name="callbackUrl" value="/checkout/podaci"');
    expect(html).toContain('name="marketingEmailConsent"');
    expect(html).toContain("Registrujte se uz Google");
    expect(html).toContain("Registrujte se uz Apple");
    expect(html).toContain("Registrujte se uz Facebook");
    expect(html).not.toContain("/nalog/registracija?callbackUrl=");
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
