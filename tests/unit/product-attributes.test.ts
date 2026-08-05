import { describe, expect, it } from "vitest";
import { formatProductAttributes } from "@/lib/product-attributes";

describe("product attributes", () => {
  it("trims and uppercases every visible attribute", () => {
    expect(
      formatProductAttributes([
        " Podesiva visina sedišta ",
        "Rotacija 360 stepeni",
        "Ergonomski mrežasti naslon",
        "Funkcija ljuljanja",
      ]),
    ).toEqual([
      "PODESIVA VISINA SEDIŠTA",
      "ROTACIJA 360 STEPENI",
      "ERGONOMSKI MREŽASTI NASLON",
      "FUNKCIJA LJULJANJA",
    ]);
  });

  it("omits empty attribute slots", () => {
    expect(formatProductAttributes([null, "", "   ", undefined])).toEqual([]);
  });
});
