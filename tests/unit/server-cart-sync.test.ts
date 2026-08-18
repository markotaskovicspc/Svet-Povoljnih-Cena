import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

let cartModule: typeof import("@/lib/api/cart");
let commerceSyncModule: typeof import("@/lib/api/commerce-sync");

beforeAll(async () => {
  cartModule = await import("@/lib/api/cart");
  commerceSyncModule = await import("@/lib/api/commerce-sync");
});

function line(sku: string, qty = 1) {
  return {
    sku,
    name: `Item ${sku}`,
    slug: `item-${sku.toLowerCase()}`,
    qty,
    unitPriceFull: 100,
    unitPriceSale: 90,
  };
}

describe("server cart login sync", () => {
  it("unions concurrent login snapshots without doubling shared SKUs", () => {
    expect(
      cartModule
        .mergeServerCartLines(
          [line("SERVER"), line("SHARED")],
          [line("GUEST"), line("SHARED", 2)],
        )
        .map((item) => [item.sku, item.qty]),
    ).toEqual([
      ["SERVER", 1],
      ["GUEST", 1],
      ["SHARED", 2],
    ]);
  });

  it("limits headerless legacy merging to the immediate login window", () => {
    const now = new Date("2026-08-18T03:30:00.000Z");
    expect(
      commerceSyncModule.isWithinLegacyLoginMergeWindow(
        new Date("2026-08-18T03:29:45.000Z"),
        now,
      ),
    ).toBe(true);
    expect(
      commerceSyncModule.isWithinLegacyLoginMergeWindow(
        new Date("2026-08-18T03:29:29.999Z"),
        now,
      ),
    ).toBe(false);
  });
});
