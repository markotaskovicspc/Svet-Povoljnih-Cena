import { describe, expect, it } from "vitest";
import {
  hasRabaluxStockObservation,
  resolveRabaluxAvailability,
  resolveRabaluxSupplierStock,
} from "@/lib/rabalux/availability";

describe("Rabalux customer availability", () => {
  it("uses approved observed Serbia stock with a one-unit buffer", () => {
    expect(
      resolveRabaluxAvailability({
        warehouseStock: 2,
        supplierStock: 18,
        supplierReservedStock: 3,
        lastSupplierStockSyncAt: new Date("2026-07-27T11:45:00.000Z"),
        supplierOperational: true,
        supplierApproved: true,
      }),
    ).toMatchObject({
      warehouseAvailable: 2,
      supplierAvailable: 14,
      sellableStock: 14,
      source: "SUPPLIER",
      supplierObserved: true,
    });
  });

  it("keeps 1 hidden and publishes 2 with one sellable unit after the reserve", () => {
    const input = {
      warehouseStock: 0,
      supplierReservedStock: 0,
      lastSupplierStockSyncAt: new Date("2026-07-27T11:50:00.000Z"),
      supplierOperational: true,
      supplierApproved: true,
    };
    expect(resolveRabaluxAvailability({ ...input, supplierStock: 1 })).toMatchObject({
      sellableStock: 0,
      supplierEligible: false,
      source: "NONE",
    });
    expect(resolveRabaluxAvailability({ ...input, supplierStock: 2 })).toMatchObject({
      sellableStock: 1,
      supplierEligible: true,
      source: "SUPPLIER",
    });
  });

  it("does not let DC stock override the weekly public threshold", () => {
    expect(
      resolveRabaluxAvailability({
        warehouseStock: 2,
        supplierStock: 1,
        supplierReservedStock: 0,
        lastSupplierStockSyncAt: new Date("2026-07-27T11:50:00.000Z"),
        supplierOperational: true,
        supplierApproved: true,
      }),
    ).toMatchObject({
      warehouseAvailable: 2,
      sellableStock: 0,
      source: "NONE",
      supplierEligible: false,
    });
  });

  it("fails closed for missing, unapproved or disabled supplier stock", () => {
    const base = {
      warehouseStock: 3,
      supplierStock: 20,
      supplierReservedStock: 0,
      lastSupplierStockSyncAt: null,
      supplierOperational: true,
      supplierApproved: true,
    };
    expect(resolveRabaluxAvailability(base)).toMatchObject({
      warehouseAvailable: 3,
      sellableStock: 0,
      supplierAvailable: 0,
      source: "NONE",
      supplierObserved: false,
    });
    expect(
      resolveRabaluxAvailability({
        ...base,
        lastSupplierStockSyncAt: new Date("2026-07-27T11:50:00.000Z"),
        supplierApproved: false,
      }).sellableStock,
    ).toBe(0);
    expect(
      resolveRabaluxAvailability({
        ...base,
        lastSupplierStockSyncAt: new Date("2026-07-27T11:50:00.000Z"),
        supplierOperational: false,
      }).sellableStock,
    ).toBe(0);
  });

  it("keeps the latest Serbia XLSX valid until another file replaces it", () => {
    const oldObservation = new Date("2025-07-19T12:00:00.000Z");
    expect(hasRabaluxStockObservation(oldObservation)).toBe(true);
    expect(
      resolveRabaluxAvailability({
        warehouseStock: 0,
        supplierStock: 20,
        supplierReservedStock: 0,
        lastSupplierStockSyncAt: oldObservation,
        supplierOperational: true,
        supplierApproved: true,
      }),
    ).toMatchObject({
      supplierObserved: true,
      supplierEligible: true,
      sellableStock: 19,
      source: "SUPPLIER",
    });
    expect(hasRabaluxStockObservation(null)).toBe(false);
    expect(hasRabaluxStockObservation("not-a-date")).toBe(false);
  });

  it("keeps exact supplier stock separate from the quantity allowed for sale", () => {
    expect(
      resolveRabaluxSupplierStock({
        supplierStock: 18,
        supplierReservedStock: 3,
        lastSupplierStockSyncAt: new Date("2026-07-27T11:45:00.000Z"),
        supplierOperational: true,
        supplierApproved: true,
      }),
    ).toMatchObject({
      rawStock: 18,
      reservedStock: 3,
      safetyStock: 1,
      netAfterSafety: 14,
      sellableStock: 14,
      status: "AVAILABLE",
    });
  });

  it("still reports the exact stock when unobserved or below the public threshold", () => {
    expect(
      resolveRabaluxSupplierStock({
        supplierStock: 1,
        supplierReservedStock: 0,
        lastSupplierStockSyncAt: new Date("2026-07-27T11:50:00.000Z"),
        supplierOperational: true,
        supplierApproved: true,
      }),
    ).toMatchObject({
      rawStock: 1,
      netAfterSafety: 0,
      sellableStock: 0,
      status: "BELOW_THRESHOLD",
    });
    expect(
      resolveRabaluxSupplierStock({
        supplierStock: 25,
        supplierReservedStock: 0,
        lastSupplierStockSyncAt: null,
        supplierOperational: true,
        supplierApproved: true,
      }),
    ).toMatchObject({
      rawStock: 25,
      sellableStock: 0,
      status: "MISSING_OBSERVATION",
    });
  });
});
