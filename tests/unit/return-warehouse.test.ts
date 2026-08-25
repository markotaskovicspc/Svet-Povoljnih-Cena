import { describe, expect, it } from "vitest";
import {
  filterReturnWarehouses,
  isReturnWarehouse,
} from "@/lib/admin/return-warehouse";

describe("reclamation return warehouses", () => {
  it("allows only an active, non-default damage or return warehouse", () => {
    expect(
      isReturnWarehouse({
        code: "MAG-002",
        name: "Magacin oštećene robe",
        active: true,
        isDefault: false,
      }),
    ).toBe(true);
    expect(
      isReturnWarehouse({
        code: "POVRATI",
        name: "Povratna roba",
        active: true,
        isDefault: false,
      }),
    ).toBe(true);
  });

  it("rejects the main DC, inactive warehouses and unrelated locations", () => {
    const warehouses = [
      { code: "DC", name: "Glavni DC", active: true, isDefault: true },
      { code: "MAG-002", name: "Oštećena roba", active: false, isDefault: false },
      { code: "ANANAS", name: "Ananas", active: true, isDefault: false },
    ];

    expect(filterReturnWarehouses(warehouses)).toEqual([]);
  });
});
