import { describe, expect, it } from "vitest";
import {
  landingPageDestinationHref,
  landingPageNavigationOptions,
  landingPageSlugFromDestinationHref,
} from "@/lib/storefront/landing-destinations";

describe("landing page navigation destinations", () => {
  it("builds the public landing-page route and reads its slug back", () => {
    const href = landingPageDestinationHref("back-to-school");
    expect(href).toBe("/ponuda/back-to-school");
    expect(landingPageSlugFromDestinationHref(href)).toBe("back-to-school");
    expect(landingPageSlugFromDestinationHref("/akcija")).toBeNull();
  });

  it("adds database landing pages to navigation with their status", () => {
    expect(
      landingPageNavigationOptions([
        {
          id: "landing-id",
          slug: "back-to-school",
          title: "Povratak u školu",
          status: "PUBLISHED",
        },
      ]),
    ).toEqual([
      {
        value: "/ponuda/back-to-school",
        label: "Landing · Povratak u školu (Objavljeno)",
      },
    ]);
  });

  it("rejects malformed or nested landing destinations", () => {
    expect(landingPageSlugFromDestinationHref("/ponuda/")).toBeNull();
    expect(landingPageSlugFromDestinationHref("/ponuda/a%2Fb")).toBeNull();
    expect(landingPageSlugFromDestinationHref("/ponuda/%E0%A4%A")).toBeNull();
  });
});
