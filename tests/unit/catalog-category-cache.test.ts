import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), configured: vi.fn(), saved: undefined as unknown }));
vi.mock("@/lib/db", () => ({
  db: { category: { findMany: mocks.findMany } }, hasDatabaseConnection: mocks.configured,
}));
vi.mock("next/cache", () => ({
  unstable_cache: (loader: (...args: unknown[]) => Promise<unknown>, keys: string[]) => {
    if (keys[0] !== "storefront-category-tree-v1") return loader;
    // Model a refresh: only a successful result replaces the saved snapshot.
    return async () => {
      mocks.saved = await loader();
      return mocks.saved;
    };
  },
}));
import { getCategoryTree } from "@/lib/api/catalog";

beforeEach(() => {
  vi.clearAllMocks(); mocks.saved = undefined; mocks.configured.mockReturnValue(true);
});

it("rejects a failed refresh without replacing the successful category snapshot", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    mocks.findMany.mockResolvedValueOnce([{ id: "chairs", slug: "stolice", name: "Stolice", parentId: null, order: 0 }]);
    const successful = await getCategoryTree();
    mocks.findMany.mockRejectedValueOnce(new Error("EMAXCONNSESSION"));
    await expect(getCategoryTree()).rejects.toThrow("EMAXCONNSESSION");
    expect(mocks.saved).toEqual(successful);
    expect(successful).toHaveLength(1);
    mocks.findMany.mockResolvedValueOnce([]);
    expect(await getCategoryTree()).toEqual([]); // A real empty catalog is valid.
    expect(mocks.saved).toEqual([]);
  } finally { log.mockRestore(); }
});

it("propagates cold-cache database errors and does not cache an unconfigured fallback", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    mocks.findMany.mockRejectedValueOnce(new Error("Connection timeout"));
    await expect(getCategoryTree()).rejects.toThrow("Connection timeout");
    expect(mocks.saved).toBeUndefined();
    mocks.configured.mockReturnValue(false);
    expect(await getCategoryTree()).toEqual([]);
    expect(mocks.saved).toBeUndefined();
    expect(mocks.findMany).toHaveBeenCalledOnce();
  } finally { log.mockRestore(); }
});
