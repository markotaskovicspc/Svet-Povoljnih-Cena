import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_SEO_DESCRIPTION, HOME_SEO_TITLE } from "@/lib/seo";

describe("public SEO identity", () => {
  it("uses the approved Google title and description", () => {
    expect(HOME_SEO_TITLE).toBe(
      "Svet Povoljnih Cena — nameštaj, kućni aparati i oprema za dom",
    );
    expect(HOME_SEO_DESCRIPTION).toBe(
      "Nameštaj, mali kućni aparati, oprema za dom i veš u ponudi Sveta Povoljnih Cena. Pogledajte karakteristike, cene, dostupnost i uslove isporuke.",
    );
  });

  it("ships the square globe-and-discount favicon", () => {
    expect(existsSync(join(process.cwd(), "src/app/icon.svg"))).toBe(true);
  });
});
