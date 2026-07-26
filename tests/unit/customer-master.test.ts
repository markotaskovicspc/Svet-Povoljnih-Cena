import { describe, expect, it } from "vitest";
import {
  customerGenderLabel,
  inferCustomerGender,
  normalizeCustomerDetails,
  normalizeCustomerName,
} from "@/lib/admin/customer-master";

describe("ERP customer master", () => {
  it.each([
    ["Ana", "ZENSKI"],
    ["Ines", "ZENSKI"],
    ["Marko", "MUSKI"],
    ["Luka", "MUSKI"],
    ["Nikola", "MUSKI"],
    ["Ilija", "MUSKI"],
    ["Saša", "NEPOZNATO"],
    ["Vanja", "NEPOZNATO"],
    ["", "NEPOZNATO"],
  ] as const)("infers %s as %s", (name, expected) => {
    expect(inferCustomerGender(name)).toBe(expected);
  });

  it("normalizes the full name and derives gender from the first name", () => {
    expect(normalizeCustomerName("  Ana   Marija Petrović  ")).toEqual({
      fullName: "Ana Marija Petrović",
      firstName: "Ana",
      lastName: "Marija Petrović",
      gender: "ZENSKI",
    });
  });

  it("normalizes all requested customer columns", () => {
    expect(
      normalizeCustomerDetails({
        name: "Luka Jovanović",
        address: "Knez Mihailova 1",
        city: "Beograd",
        postalCode: "11000",
        phone: "+381 64 123 4567",
        email: " LUKA@EXAMPLE.COM ",
      }),
    ).toEqual({
      fullName: "Luka Jovanović",
      firstName: "Luka",
      lastName: "Jovanović",
      address: "Knez Mihailova 1",
      city: "Beograd",
      postalCode: "11000",
      phone: "+381 64 123 4567",
      email: "luka@example.com",
      gender: "MUSKI",
    });
  });

  it("uses readable Serbian gender labels", () => {
    expect(customerGenderLabel("ZENSKI")).toBe("Ženski");
    expect(customerGenderLabel("MUSKI")).toBe("Muški");
    expect(customerGenderLabel("NEPOZNATO")).toBe("Nepoznato");
  });

  it("rejects an invalid e-mail address", () => {
    expect(() =>
      normalizeCustomerDetails({ name: "Ana Anić", email: "nije-email" }),
    ).toThrow("Unesite ispravnu e-mail adresu.");
  });
});
