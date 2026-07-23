import { describe, expect, it } from "vitest";
import { getErpModuleDefinition } from "@/lib/admin/erp";
import {
  PURCHASE_PRICE_MAX,
  composePurchasePriceAttributes,
  composePurchasePricePattern,
  normalizePurchasePriceSku,
  parsePurchasePriceDate,
  parsePurchasePriceValue,
  validatePurchasePricePeriod,
} from "@/lib/admin/purchase-price";

describe("ERP purchase-price module", () => {
  it("matches the requested commands, overview and write permissions", () => {
    const purchasePriceModule = getErpModuleDefinition("nabavne-cene");

    expect(purchasePriceModule?.commands.map((command) => command.label)).toEqual([
      "Unos nove",
      "Uredi",
      "Brisanje",
    ]);
    expect(
      purchasePriceModule?.columns
        .filter((column) => column.defaultVisible)
        .map((column) => [column.key, column.label]),
    ).toEqual([
      ["sku", "Šifra artikla"],
      ["supplier", "Dobavljač"],
      ["name", "Naziv artikla"],
      ["attributes", "Atributi artikla"],
      ["pattern", "Dezen artikla"],
      ["purchasePrice", "Nabavna cena"],
      ["currency", "Valuta"],
      ["parity", "Paritet"],
      ["validFrom", "Važenje cene od"],
      ["validTo", "Važenje cene do"],
    ]);
    expect(purchasePriceModule?.editableColumns).toEqual([
      "sku",
      "purchasePrice",
      "validFrom",
      "validTo",
    ]);
    expect(
      purchasePriceModule?.commands
        .find((command) => command.action === "purchase-price.create")
        ?.fields?.map((field) => [field.key, field.required ?? false]),
    ).toEqual([
      ["sku", true],
      ["purchasePrice", true],
      ["validFrom", true],
      ["validTo", false],
    ]);
  });

  it("composes attributes from article master data with a size fallback", () => {
    expect(
      composePurchasePriceAttributes({
        attribute1: " Masiv ",
        attribute2: null,
        attribute3: "Metal",
        attribute4: "",
        sizeLabel: "80x40",
      }),
    ).toBe("Masiv / Metal");
    expect(composePurchasePriceAttributes({ sizeLabel: " 80x40 " })).toBe(
      "80x40",
    );
    expect(composePurchasePriceAttributes({})).toBeNull();
  });

  it("composes the article pattern from both colors", () => {
    expect(
      composePurchasePricePattern({
        colorPrimary: " Natur ",
        colorSecondary: "Grafit",
      }),
    ).toBe("Natur + Grafit");
    expect(composePurchasePricePattern({ colorPrimary: "Bela" })).toBe("Bela");
    expect(composePurchasePricePattern({})).toBeNull();
  });

  it.each([
    [" SKU-001 ", "SKU-001"],
    ["šifra/1", "šifra/1"],
  ])("normalizes a valid article code", (value, expected) => {
    expect(normalizePurchasePriceSku(value)).toBe(expected);
  });

  it.each([null, 1, "", "   ", "x".repeat(101)])(
    "rejects a missing or oversized article code: %j",
    (value) => {
      expect(() => normalizePurchasePriceSku(value)).toThrow(/Šifra artikla/);
    },
  );

  it.each([
    [0, "0"],
    [12, "12"],
    [12.3, "12.3"],
    ["12,34", "12.34"],
    ["00012.30", "00012.30"],
    [String(PURCHASE_PRICE_MAX), String(PURCHASE_PRICE_MAX)],
  ])("accepts a valid purchase price %j", (value, expected) => {
    expect(parsePurchasePriceValue(value)).toBe(expected);
  });

  it.each([
    null,
    "",
    "abc",
    -1,
    "-0.01",
    "1.234",
    "1e3",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "10000000000",
  ])("rejects an invalid purchase price: %j", (value) => {
    expect(() => parsePurchasePriceValue(value)).toThrow(/Nabavna cena/);
  });

  it("strictly parses real calendar dates at UTC midnight", () => {
    expect(
      parsePurchasePriceDate("2028-02-29", "Važenje cene od").toISOString(),
    ).toBe("2028-02-29T00:00:00.000Z");
  });

  it.each([
    "2027-02-29",
    "2026-02-30",
    "2026-13-01",
    "23.07.2026",
    "2026-7-3",
    "",
  ])("rejects an invalid calendar date: %s", (value) => {
    expect(() =>
      parsePurchasePriceDate(value, "Važenje cene od"),
    ).toThrow(/ispravan datum/);
  });

  it("allows an open-ended or same-day period and rejects a reversed period", () => {
    const from = parsePurchasePriceDate("2026-07-23", "Od");
    const sameDay = parsePurchasePriceDate("2026-07-23", "Do");
    const before = parsePurchasePriceDate("2026-07-22", "Do");

    expect(() => validatePurchasePricePeriod(from, null)).not.toThrow();
    expect(() => validatePurchasePricePeriod(from, sameDay)).not.toThrow();
    expect(() => validatePurchasePricePeriod(from, before)).toThrow(
      /ne može biti pre/,
    );
  });
});
