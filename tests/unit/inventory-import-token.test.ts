import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInventoryImportToken,
  verifyInventoryImportToken,
} from "@/lib/admin/inventory-import-token";

describe("inventory import preview confirmation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("binds the confirmation to admin, file, stock snapshot and expiry", () => {
    vi.stubEnv("AUTH_SECRET", "inventory-import-test-secret-32-chars");
    const expected = {
      adminId: "admin-1",
      fileHash: "file-a",
      stateHash: "state-a",
    };
    const token = createInventoryImportToken(expected, 1_000);

    expect(verifyInventoryImportToken(token, expected, 2_000)).toBe(true);
    expect(
      verifyInventoryImportToken(token, { ...expected, fileHash: "file-b" }, 2_000),
    ).toBe(false);
    expect(
      verifyInventoryImportToken(token, { ...expected, stateHash: "state-b" }, 2_000),
    ).toBe(false);
    expect(verifyInventoryImportToken(token, expected, 1_000 + 15 * 60_000 + 1)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    vi.stubEnv("AUTH_SECRET", "inventory-import-test-secret-32-chars");
    const expected = { adminId: "admin-1", fileHash: "file-a", stateHash: "state-a" };
    const token = createInventoryImportToken(expected);
    expect(verifyInventoryImportToken(`${token}x`, expected)).toBe(false);
  });
});
