import { describe, expect, it } from "vitest";
import {
  courierAddressParts,
  formatStreetAddress,
  isValidHouseNumber,
  normalizeHouseNumber,
  splitStreetAndHouseNumber,
} from "@/lib/address/house-number";

describe("house number normalization", () => {
  it.each(["12", "12A", "12/3", "12-14", "bb", "B.B."])(
    "accepts %s",
    (value) => expect(isValidHouseNumber(value)).toBe(true),
  );

  it.each(["", "0", "bez broja", "12 A B", "12.5"])("rejects %s", (value) =>
    expect(isValidHouseNumber(value)).toBe(false),
  );

  it("normalizes bb and whitespace", () => {
    expect(normalizeHouseNumber(" B.B. ")).toBe("bb");
    expect(normalizeHouseNumber(" 12 / 3 ")).toBe("12/3");
  });

  it("stores the exact number in parentheses and can read old addresses", () => {
    expect(formatStreetAddress("Jurija Gagarina", "32")).toBe(
      "Jurija Gagarina (32)",
    );
    expect(splitStreetAndHouseNumber("29. Novembra 11")).toEqual({
      street: "29. Novembra",
      houseNumber: "11",
    });
    expect(splitStreetAndHouseNumber("Jurija Gagarina (12A)")).toEqual({
      street: "Jurija Gagarina",
      houseNumber: "12A",
    });
  });

  it("maps provider number to the leading integer while preserving the original", () => {
    expect(courierAddressParts("Jurija Gagarina", "12/3")).toEqual({
      street: "Jurija Gagarina",
      displayStreet: "Jurija Gagarina (12/3)",
      originalHouseNumber: "12/3",
      providerHouseNumber: "12",
      providerHouseNumberInfo: "/3",
    });
    expect(courierAddressParts("Evropska", "bb")).toMatchObject({
      displayStreet: "Evropska (bb)",
      providerHouseNumber: "1",
      providerHouseNumberInfo: "bb",
    });
  });
});
