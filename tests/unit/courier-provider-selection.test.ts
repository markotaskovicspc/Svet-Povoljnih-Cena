import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    adminSetting: {
      findUnique: dbMocks.findUnique,
      upsert: dbMocks.upsert,
    },
  },
}));

import {
  getSelectedSmallParcelProvider,
  normalizeSmallParcelProvider,
  setSelectedSmallParcelProvider,
  SMALL_PARCEL_PROVIDER_SETTING_KEY,
} from "@/lib/courier/provider-selection";

const originalProvider = process.env.COURIER_SMALL_PROVIDER;

describe("small parcel provider selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COURIER_SMALL_PROVIDER = "X_EXPRESS";
  });

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.COURIER_SMALL_PROVIDER;
    } else {
      process.env.COURIER_SMALL_PROVIDER = originalProvider;
    }
  });

  it("uses the persisted admin choice before the environment default", async () => {
    dbMocks.findUnique.mockResolvedValue({ value: "MYGLS" });

    await expect(getSelectedSmallParcelProvider()).resolves.toBe("MYGLS");
    expect(dbMocks.findUnique).toHaveBeenCalledWith({
      where: { key: SMALL_PARCEL_PROVIDER_SETTING_KEY },
      select: { value: true },
    });
  });

  it("falls back to the environment for a missing or invalid setting", async () => {
    process.env.COURIER_SMALL_PROVIDER = "MYGLS";
    dbMocks.findUnique.mockResolvedValue({ value: "not-a-provider" });

    await expect(getSelectedSmallParcelProvider()).resolves.toBe("MYGLS");
  });

  it("normalizes the Xpress spelling and rejects other JSON values", () => {
    expect(normalizeSmallParcelProvider("xpress")).toBe("X_EXPRESS");
    expect(normalizeSmallParcelProvider("X_EXPRESS")).toBe("X_EXPRESS");
    expect(normalizeSmallParcelProvider({ provider: "MYGLS" })).toBeNull();
  });

  it("upserts the audited admin choice", async () => {
    dbMocks.upsert.mockResolvedValue({ key: SMALL_PARCEL_PROVIDER_SETTING_KEY });

    await setSelectedSmallParcelProvider("X_EXPRESS", "admin-1");

    expect(dbMocks.upsert).toHaveBeenCalledWith({
      where: { key: SMALL_PARCEL_PROVIDER_SETTING_KEY },
      create: {
        key: SMALL_PARCEL_PROVIDER_SETTING_KEY,
        value: "X_EXPRESS",
        updatedBy: "admin-1",
      },
      update: {
        value: "X_EXPRESS",
        updatedBy: "admin-1",
      },
    });
  });
});
