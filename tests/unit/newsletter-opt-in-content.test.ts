import { describe, expect, it } from "vitest";
import { renderNewsletterOptInEmail } from "@/lib/newsletter/contacts";

describe("newsletter opt-in email content", () => {
  it("uses the blue branded shell, logo and safe confirmation link", () => {
    const result = renderNewsletterOptInEmail(
      "https://example.test/newsletter/potvrdi?token=a&next=\"unsafe\"",
      "https://example.test",
    );

    expect(result.html).toContain("background:#F2F6F8");
    expect(result.html).toContain("border-top:5px solid #123F5A");
    expect(result.html).toContain(
      "https://example.test/documents/garantni-list-logo.jpeg",
    );
    expect(result.html).toContain("Potvrdite newsletter prijavu");
    expect(result.html).toContain("token=a&amp;next=&quot;unsafe&quot;");
    expect(result.text).toContain("https://example.test/newsletter/potvrdi");
  });
});
