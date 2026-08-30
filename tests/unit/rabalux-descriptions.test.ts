import { describe, expect, it } from "vitest";
import { rabaluxShortDescription } from "@/lib/rabalux/descriptions";

describe("Rabalux short descriptions", () => {
  it("uses the specific product type instead of truncating marketing prose", () => {
    expect(
      rabaluxShortDescription({
        type: "  Stone   lampe ",
        category: "Unutrašnja rasveta",
      }),
    ).toBe("Stone lampe");
  });

  it("falls back to the supplier category when a type is unavailable", () => {
    expect(
      rabaluxShortDescription({
        type: null,
        category: "Spoljna rasveta",
      }),
    ).toBe("Spoljna rasveta");
  });
});
