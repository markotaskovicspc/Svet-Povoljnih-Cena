import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  supplierFindUnique: vi.fn(),
  productUpdateMany: vi.fn(),
  isRabaluxEnabled: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    supplier: { findUnique: mocks.supplierFindUnique },
    product: { updateMany: mocks.productUpdateMany },
  },
}));

vi.mock("@/lib/rabalux/config", () => ({
  isRabaluxEnabled: mocks.isRabaluxEnabled,
  isRabaluxSupplierOperational: vi.fn(),
}));

import { disableInvalidRabaluxWebAvailability } from "@/lib/channel-availability.server";

describe("Rabalux web availability maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isRabaluxEnabled.mockReturnValue(true);
    mocks.supplierFindUnique.mockResolvedValue({ id: "supplier-rabalux", enabled: true });
    mocks.productUpdateMany.mockResolvedValue({ count: 4 });
  });

  it("resolves the supplier once and updates by supplierId", async () => {
    await expect(disableInvalidRabaluxWebAvailability()).resolves.toBe(4);

    expect(mocks.supplierFindUnique).toHaveBeenCalledWith({
      where: { integrationKey: "RABALUX" },
      select: { id: true, enabled: true },
    });
    expect(mocks.productUpdateMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        availableWebAuto: true,
        supplierId: "supplier-rabalux",
        OR: [
          { lastSupplierStockSyncAt: null },
          { supplierApprovalStatus: null },
          { supplierApprovalStatus: { not: "APPROVED" } },
        ],
      },
      data: { availableWebAuto: false },
    });
  });

  it("turns off all automatic Rabalux availability when the integration is disabled", async () => {
    mocks.isRabaluxEnabled.mockReturnValue(false);

    await disableInvalidRabaluxWebAvailability();

    expect(mocks.productUpdateMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        availableWebAuto: true,
        supplierId: "supplier-rabalux",
      },
      data: { availableWebAuto: false },
    });
  });
});
