import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ connected: vi.fn(), products: vi.fn(), categories: vi.fn(), collections: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/db", () => ({
  hasDatabaseConnection: mocks.connected,
  db: { product: { findMany: mocks.products }, category: { findMany: mocks.categories }, collection: { findMany: mocks.collections } },
}));
vi.mock("@/lib/web-storefront-availability", () => ({ webStorefrontProductWhere: () => ({ webActive: true }) }));
import { getSeoCatalog } from "@/lib/seo/catalog.server";

beforeEach(() => {
  mocks.connected.mockReturnValue(true);
  mocks.products.mockResolvedValue([]);
  mocks.categories.mockResolvedValue([]);
  mocks.collections.mockResolvedValue([]);
});

it("supports development without a configured database", async () => {
  mocks.connected.mockReturnValue(false);
  expect(await getSeoCatalog()).toBeNull();
  expect(mocks.products).not.toHaveBeenCalled();
});

it("propagates database errors instead of caching an empty public catalog", async () => {
  mocks.products.mockRejectedValue(new Error("connection lost"));
  await expect(getSeoCatalog()).rejects.toThrow("connection lost");
});
