import { describe, expect, it } from "vitest";
import {
  formatSupplierCode,
  SUPPLIER_PARITY_OPTIONS,
} from "@/lib/supplier-master";
import { getErpModuleDefinition } from "@/lib/admin/erp";

describe("supplier master data", () => {
  it("formats an automatically assigned supplier code", () => {
    expect(formatSupplierCode(1)).toBe("DOB-0001");
    expect(formatSupplierCode(10_000)).toBe("DOB-10000");
  });

  it("rejects invalid supplier serials", () => {
    expect(() => formatSupplierCode(0)).toThrow(/pozitivan ceo broj/);
    expect(() => formatSupplierCode(1.5)).toThrow(/pozitivan ceo broj/);
  });

  it("offers the complete Incoterms 2020 parity list", () => {
    expect(SUPPLIER_PARITY_OPTIONS).toEqual([
      "EXW",
      "FCA",
      "CPT",
      "CIP",
      "DAP",
      "DPU",
      "DDP",
      "FAS",
      "FOB",
      "CFR",
      "CIF",
    ]);
  });

  it("matches the client command and overview requirements", () => {
    const supplierModule = getErpModuleDefinition("dobavljaci");

    expect(supplierModule?.commands.map((command) => command.label)).toEqual([
      "Unos novog",
      "Uredi",
      "Brisanje",
    ]);
    expect(
      supplierModule?.columns
        .filter((column) => column.defaultVisible)
        .map((column) => column.key),
    ).toEqual([
      "code",
      "name",
      "address",
      "city",
      "country",
      "email",
      "phone",
      "currency",
      "parity",
      "paymentTerms",
      "deliveryDays",
      "transitDays",
      "bank",
      "swift",
      "iban",
      "defaultPriceList",
      "loading1",
      "loading2",
      "loading3",
    ]);
    expect(supplierModule?.editableColumns).not.toContain("code");
    expect(supplierModule?.columns.map((column) => column.key)).not.toContain(
      "exchangeRate",
    );
  });
});
