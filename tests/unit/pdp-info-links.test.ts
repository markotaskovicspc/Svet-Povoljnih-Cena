import { describe, expect, it } from "vitest";
import { resolveDeliveryTermsContent } from "@/components/product/pdp-info-links";

describe("PDP uslovi isporuke", () => {
  it("koristi centralni CMS tekst kada artikal nema poseban unos", () => {
    expect(
      resolveDeliveryTermsContent("   ", "## Rokovi isporuke\n\nStandardni tekst."),
    ).toEqual({
      content: "## Rokovi isporuke\n\nStandardni tekst.",
      format: "markdown",
    });
  });

  it("daje prednost objavljenom centralnom CMS tekstu", () => {
    expect(
      resolveDeliveryTermsContent(
        "  Poseban rok isporuke je 5 dana.  ",
        "## Standardni uslovi",
      ),
    ).toEqual({
      content: "## Standardni uslovi",
      format: "markdown",
    });
  });

  it("zadržava bezbedni rezervni tekst ako CMS nije dostupan", () => {
    const resolved = resolveDeliveryTermsContent(undefined, undefined);

    expect(resolved.format).toBe("richText");
    expect(resolved.content).toContain("Konačan obračun");
  });
});
