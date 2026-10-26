import { expect, it } from "vitest";
import { renderEmail } from "@/lib/email/render";
import { BankPaymentConfirmation } from "@/lib/email/templates/bank-payment-confirmation";

it("escapes buyer data and renders the receipt's currency in the shared layout", async () => {
  const { html, text } = await renderEmail(BankPaymentConfirmation({
    orderNumber: "INO-2026-000123", amountMinor: 9876, currency: "EUR",
    firstName: '<img src=x onerror="alert(1)">', orderUrl: null,
  }));
  expect(html).toContain("&lt;img src=x"); expect(html).not.toContain('<img src="x"');
  expect(text).toContain("98,76 EUR"); expect(text).not.toContain("98,76 din");
  expect(html).toContain("/documents/garantni-list-logo.jpeg");
  expect(html).toContain("mailto:podrska@svetpovoljnihcena.rs");
  expect(html).not.toContain("Pogledaj porudžbinu");
  expect(text).not.toContain("Uplatite");
});
