import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_SEO_DESCRIPTION, HOME_SEO_TITLE } from "@/lib/seo";

describe("public SEO identity", () => {
  it("uses the approved Google title and description", () => {
    expect(HOME_SEO_TITLE).toBe(
      "Svet povoljnih cena – mesto gde su dobre ponude dostupne svima!",
    );
    expect(HOME_SEO_DESCRIPTION).toBe(
      "Dobrodošli na platformu koja iskustvo kupovine čini jednostavnim, sigurnim i bez stresa, uz garanciju kratkih rokova isporuke.",
    );
  });

  it("ships the square globe-and-discount favicon", () => {
    expect(existsSync(join(process.cwd(), "src/app/icon.svg"))).toBe(true);
  });
});
