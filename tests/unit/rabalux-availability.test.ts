import { describe, expect, it } from "vitest";
import {
  isRabaluxStockFresh,
  resolveRabaluxAvailability,
} from "@/lib/rabalux/availability";

describe("Rabalux customer availability", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");

  it("combines DC and approved fresh supplier stock with a one-unit buffer", () => {
    expect(
      resolveRabaluxAvailability({
        warehouseStock: 2,
        supplierStock: 8,
        supplierReservedStock: 3,
        lastSupplierStockSyncAt: new Date("2026-07-27T11:45:00.000Z"),
        supplierOperational: true,
        supplierApproved: true,
        now,
      }),
    ).toMatchObject({
      warehouseAvailable: 2,
      supplierAvailable: 4,
      sellableStock: 6,
      source: "MIXED",
      supplierFresh: true,
    });
  });

  it("fails closed for stale, unapproved or disabled supplier stock while preserving DC", () => {
    const base = {
      warehouseStock: 3,
      supplierStock: 20,
      supplierReservedStock: 0,
      lastSupplierStockSyncAt: new Date("2026-07-27T11:29:59.000Z"),
      supplierOperational: true,
      supplierApproved: true,
      now,
    };
    expect(resolveRabaluxAvailability(base)).toMatchObject({
      sellableStock: 3,
      supplierAvailable: 0,
      source: "DC",
      supplierFresh: false,
    });
    expect(
      resolveRabaluxAvailability({
        ...base,
        lastSupplierStockSyncAt: new Date("2026-07-27T11:50:00.000Z"),
        supplierApproved: false,
      }).sellableStock,
    ).toBe(3);
    expect(
      resolveRabaluxAvailability({
        ...base,
        lastSupplierStockSyncAt: new Date("2026-07-27T11:50:00.000Z"),
        supplierOperational: false,
      }).sellableStock,
    ).toBe(3);
  });

  it("uses a strict thirty-minute freshness window", () => {
    expect(
      isRabaluxStockFresh(new Date("2026-07-27T11:30:00.000Z"), now),
    ).toBe(true);
    expect(
      isRabaluxStockFresh(new Date("2026-07-27T11:29:59.999Z"), now),
    ).toBe(false);
  });
});
