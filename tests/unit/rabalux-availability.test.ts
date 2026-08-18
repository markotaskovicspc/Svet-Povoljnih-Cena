import { describe, expect, it } from "vitest";
import {
  isRabaluxStockFresh,
  resolveRabaluxAvailability,
  resolveRabaluxSupplierStock,
} from "@/lib/rabalux/availability";

describe("Rabalux customer availability", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");

  it("uses approved fresh Serbia stock with a one-unit buffer", () => {
    expect(
      resolveRabaluxAvailability({
        warehouseStock: 2,
        supplierStock: 18,
        supplierReservedStock: 3,
        lastSupplierStockSyncAt: new Date("2026-07-27T11:45:00.000Z"),
        supplierOperational: true,
        supplierApproved: true,
        now,
      }),
    ).toMatchObject({
      warehouseAvailable: 2,
      supplierAvailable: 14,
      sellableStock: 14,
      source: "SUPPLIER",
      supplierFresh: true,
    });
  });

  it("requires raw Serbia stock to be at least 3", () => {
    const input = {
      warehouseStock: 0,
      supplierReservedStock: 0,
      lastSupplierStockSyncAt: new Date("2026-07-27T11:50:00.000Z"),
      supplierOperational: true,
      supplierApproved: true,
      now,
    };
    expect(resolveRabaluxAvailability({ ...input, supplierStock: 2 })).toMatchObject({
      sellableStock: 0,
      supplierEligible: false,
      source: "NONE",
    });
    expect(resolveRabaluxAvailability({ ...input, supplierStock: 3 })).toMatchObject({
      sellableStock: 2,
      supplierEligible: true,
      source: "SUPPLIER",
    });
  });

  it("does not let DC stock override the weekly 3-unit threshold", () => {
    expect(
      resolveRabaluxAvailability({
        warehouseStock: 2,
        supplierStock: 2,
        supplierReservedStock: 0,
        lastSupplierStockSyncAt: new Date("2026-07-27T11:50:00.000Z"),
        supplierOperational: true,
        supplierApproved: true,
        now,
      }),
    ).toMatchObject({
      warehouseAvailable: 2,
      sellableStock: 0,
      source: "NONE",
      supplierEligible: false,
    });
  });

  it("fails closed for stale, unapproved or disabled supplier stock", () => {
    const base = {
      warehouseStock: 3,
      supplierStock: 20,
      supplierReservedStock: 0,
      lastSupplierStockSyncAt: new Date("2026-07-19T11:59:59.000Z"),
      supplierOperational: true,
      supplierApproved: true,
      now,
    };
    expect(resolveRabaluxAvailability(base)).toMatchObject({
      warehouseAvailable: 3,
      sellableStock: 0,
      supplierAvailable: 0,
      source: "NONE",
      supplierFresh: false,
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

  it("uses an eight-day freshness window for the weekly Serbia XLSX", () => {
    expect(
      isRabaluxStockFresh(new Date("2026-07-19T12:00:00.000Z"), now),
    ).toBe(true);
    expect(
      isRabaluxStockFresh(new Date("2026-07-19T11:59:59.999Z"), now),
    ).toBe(false);
  });

  it("keeps exact supplier stock separate from the quantity allowed for sale", () => {
    expect(
      resolveRabaluxSupplierStock({
        supplierStock: 18,
        supplierReservedStock: 3,
        lastSupplierStockSyncAt: new Date("2026-07-27T11:45:00.000Z"),
        supplierOperational: true,
        supplierApproved: true,
        now,
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

  it("still reports the exact stock when stale or below the public threshold", () => {
    expect(
      resolveRabaluxSupplierStock({
        supplierStock: 2,
        supplierReservedStock: 0,
        lastSupplierStockSyncAt: new Date("2026-07-27T11:50:00.000Z"),
        supplierOperational: true,
        supplierApproved: true,
        now,
      }),
    ).toMatchObject({
      rawStock: 2,
      netAfterSafety: 1,
      sellableStock: 0,
      status: "BELOW_THRESHOLD",
    });
    expect(
      resolveRabaluxSupplierStock({
        supplierStock: 25,
        supplierReservedStock: 0,
        lastSupplierStockSyncAt: new Date("2026-07-19T11:00:00.000Z"),
        supplierOperational: true,
        supplierApproved: true,
        now,
      }),
    ).toMatchObject({ rawStock: 25, sellableStock: 0, status: "STALE" });
  });
});
