import { describe, expect, it } from "vitest";
import {
  normalizeWarehouseDetails,
  normalizeWarehouseEmail,
  normalizeWarehouseName,
  normalizeWarehousePhone,
} from "@/lib/admin/warehouse-master";

describe("warehouse master data validation", () => {
  it("normalizes the five client-requested fields", () => {
    expect(
      normalizeWarehouseDetails({
        name: "  Centralni magacin  ",
        address: "  Industrijska 12  ",
        city: "  Beograd  ",
        email: "  MAGACIN@EXAMPLE.COM  ",
        phone: "  +381 11 123 456  ",
      }),
    ).toEqual({
      name: "Centralni magacin",
      address: "Industrijska 12",
      city: "Beograd",
      email: "magacin@example.com",
      phone: "+381 11 123 456",
    });
  });

  it("requires a warehouse name while allowing optional contact fields", () => {
    expect(() => normalizeWarehouseName("   ")).toThrow(
      "Naziv magacina je obavezan.",
    );
    expect(
      normalizeWarehouseDetails({
        name: "Izdvojeni magacin",
        address: "",
        city: "",
        email: "",
        phone: "",
      }),
    ).toEqual({
      name: "Izdvojeni magacin",
      address: null,
      city: null,
      email: null,
      phone: null,
    });
  });

  it.each(["bez-at-znaka.example.com", "a@b", "a b@example.com"])(
    "rejects invalid email %s",
    (email) => {
      expect(() => normalizeWarehouseEmail(email)).toThrow(
        "Unesite ispravnu e-mail adresu.",
      );
    },
  );

  it.each(["kratko", "12345", "011-ABC-123", "*381 11 123456"])(
    "rejects invalid phone %s",
    (phone) => {
      expect(() => normalizeWarehousePhone(phone)).toThrow(
        "Unesite ispravan broj telefona.",
      );
    },
  );
});
