import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, webAvailable, resolveRabalux, supplierOperational } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  webAvailable: vi.fn(),
  resolveRabalux: vi.fn(),
  supplierOperational: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { product: { findUnique } } }));
vi.mock("@/lib/api/catalog", () => ({ getProductBySlug: vi.fn() }));
vi.mock("@/lib/product-availability", () => ({ getProductAvailability: vi.fn() }));
vi.mock("@/lib/web-storefront-availability", () => ({ isProductAvailableOnWeb: webAvailable }));
vi.mock("@/lib/rabalux/availability", () => ({ resolveRabaluxAvailability: resolveRabalux }));
vi.mock("@/lib/rabalux/config", () => ({ isRabaluxSupplierOperational: supplierOperational }));

import { POST } from "@/app/api/products/[slug]/availability/route";

const product = {
  stock: 0,
  dcAvailableQty: 12,
  supplier: null,
  supplierStock: null,
  supplierReservedStock: 0,
  lastSupplierStockSyncAt: null,
  supplierApprovalStatus: null,
};

async function check(quantity: number) {
  return POST(new Request("http://localhost/api/products/100020-df01cc/availability", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity }),
  }), { params: Promise.resolve({ slug: "100020-df01cc" }) });
}

describe("add-to-cart availability", () => {
  beforeEach(() => {
    findUnique.mockReset().mockResolvedValue({ ...product });
    webAvailable.mockReset().mockReturnValue(true);
    resolveRabalux.mockReset().mockReturnValue({ sellableStock: 8 });
    supplierOperational.mockReset().mockReturnValue(true);
  });

  it("accepts DC stock even when the legacy aggregate stock is zero", async () => {
    expect(await (await check(12)).json()).toMatchObject({ available: true, message: null });
    expect(resolveRabalux).not.toHaveBeenCalled();
  });

  it("rejects quantities exceeding available DC stock", async () => {
    expect(await (await check(13)).json()).toMatchObject({ available: false });
  });

  it("does not sell legacy stock when DC availability is exhausted", async () => {
    findUnique.mockResolvedValue({ ...product, stock: 100, dcAvailableQty: 0 });
    expect(await (await check(1)).json()).toMatchObject({ available: false });
  });

  it("keeps supplier availability rules for Rabalux", async () => {
    const supplier = { integrationKey: "RABALUX", enabled: true };
    findUnique.mockResolvedValue({ ...product, dcAvailableQty: 0, supplier, supplierApprovalStatus: "APPROVED" });
    expect(await (await check(8)).json()).toMatchObject({ available: true });
    expect(await (await check(9)).json()).toMatchObject({ available: false });
    expect(resolveRabalux).toHaveBeenCalledWith(expect.objectContaining({ warehouseStock: 0, supplierOperational: true, supplierApproved: true }));
  });

  it("continues to reject products disabled for web sales", async () => {
    webAvailable.mockReturnValue(false);
    expect(await (await check(1)).json()).toMatchObject({ available: false, message: "Artikal trenutno nije dostupan za online kupovinu." });
  });

  it("rejects invalid quantities before querying stock", async () => {
    expect((await check(0)).status).toBe(400);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
