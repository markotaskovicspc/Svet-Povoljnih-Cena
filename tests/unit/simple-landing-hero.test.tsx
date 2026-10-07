import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SimpleLandingHero } from "@/components/landing/simple-landing-hero";

const hero = {
  heroImageUrl: null,
  heroMobileImageUrl: null,
  heroImageAlt: "Ponuda kofera",
  heroCtaLabel: null,
  heroCtaHref: null,
};

describe("optional simple landing banner", () => {
  it("does not reserve empty banner space when no image is selected", () => {
    expect(renderToStaticMarkup(<SimpleLandingHero snapshot={hero} />)).toBe("");
  });

  it("hides an existing CTA when the banner image is removed", () => {
    expect(renderToStaticMarkup(<SimpleLandingHero snapshot={{
      ...hero,
      heroCtaLabel: "Pogledajte proizvode",
      heroCtaHref: "#proizvodi",
    }} />)).toBe("");
  });

  it("renders an image without requiring a CTA", () => {
    const html = renderToStaticMarkup(<SimpleLandingHero snapshot={{
      ...hero,
      heroImageUrl: "/images/landing-banner.jpg",
    }} />);

    expect(html).toContain('aria-label="Glavni baner"');
    expect(html).toContain('alt="Ponuda kofera"');
    expect(html).not.toContain("<a ");
  });

  it("uses the mobile image as a fallback when it is the only image", () => {
    const html = renderToStaticMarkup(<SimpleLandingHero snapshot={{
      ...hero,
      heroMobileImageUrl: "/images/landing-mobile.jpg",
      heroCtaLabel: "Pogledajte proizvode",
      heroCtaHref: "#proizvodi",
    }} />);

    expect(html).toContain('aria-label="Glavni baner"');
    expect(html).toContain("landing-mobile.jpg");
    expect(html).toContain('href="#proizvodi"');
  });
});
