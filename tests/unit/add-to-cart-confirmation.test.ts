import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ error: vi.fn(), event: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("@/components/analytics/first-party-analytics", () => ({ recordFirstPartyEvent: mocks.event, recordCommerceAddToCart: vi.fn() }));
vi.mock("@/lib/pricing", () => ({ effectiveUnitPrice: () => ({ full: 1000, effective: 700 }) }));
vi.mock("@/lib/media", () => ({ getMediaVariantUrl: () => "/chair.webp" }));
vi.mock("@/lib/product-availability", () => ({ getProductAvailability: () => ({ canAddToCart: true }) }));
import { commitAddToCart } from "@/components/cart/add-to-cart-action";
import { useCart } from "@/lib/hooks/use-cart";
import { useCartUi } from "@/lib/hooks/use-cart-ui";
import type { Product } from "@/types";
const product = { id: "chair", sku: "chair-1", slug: "chair", name: "Stolica", media: { images: ["/chair.webp"] }, categoryPath: [], variantFamily: { code: "family", options: [{ sku: "chair-1", label: "Bež" }] } } as unknown as Product;
describe("add-to-cart confirmation flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCart.setState({ lines: [] });
    useCartUi.setState({ addedItem: null, drawerOpen: false, wishlistOpen: false, crossSellSku: null, suggestionDestination: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: true }) }));
  });
  afterEach(() => vi.unstubAllGlobals());
  it("opens a product confirmation after successful add and closes competing overlays", async () => {
    useCartUi.setState({ wishlistOpen: true, crossSellSku: "old", suggestionDestination: "/korpa" });
    await commitAddToCart(product, 2);
    expect(useCart.getState().lines[0]).toMatchObject({ sku: "chair-1", qty: 2 });
    expect(useCartUi.getState()).toMatchObject({ addedItem: { addedQty: 2, line: { name: "Stolica", thumbnailUrl: "/chair.webp", variant: "Bež", unitPriceSale: 700 } }, wishlistOpen: false, crossSellSku: null, suggestionDestination: null });
    useCartUi.getState().closeAddedItem();
    expect(useCartUi.getState().addedItem).toBeNull();
    expect(useCart.getState().lines[0].qty).toBe(2);
  });
  it("does not show success or add an item if availability fails", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ available: false, message: "Nije dostupno" }) } as Response);
    await commitAddToCart(product);
    expect(useCartUi.getState().addedItem).toBeNull();
    expect(useCart.getState().lines).toEqual([]);
    expect(mocks.error).toHaveBeenCalledWith("Nije dostupno");
  });
  it("reports the newly added quantity, while keeping the full basket quantity", async () => {
    await commitAddToCart(product, 2);
    useCartUi.getState().closeAddedItem();
    await commitAddToCart(product, 1);
    expect(useCartUi.getState().addedItem).toMatchObject({ addedQty: 1, line: { qty: 3 } });
  });
});
