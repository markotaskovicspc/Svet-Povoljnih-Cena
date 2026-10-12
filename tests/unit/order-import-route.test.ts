import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), createOrder: vi.fn(), audit: vi.fn(), products: vi.fn(), towns: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentAdmin: mocks.admin }));
vi.mock("@/lib/admin", () => ({ isAuthorized: (role: string) => ["OPS", "SUPER"].includes(role), logAudit: mocks.audit }));
vi.mock("@/lib/api/checkout", () => ({ createOrder: mocks.createOrder }));
vi.mock("@/lib/db", () => ({ db: { product: { findMany: mocks.products }, xExpressTown: { findMany: mocks.towns } } }));
vi.mock("@/lib/env", () => ({ envValue: () => "test-secret" }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimitForRequest: async () => ({ ok: true }), rateLimitJson: vi.fn() }));
import { POST } from "@/app/api/admin/erp/order-import/route";
import { signImportQuote, type ImportQuote } from "@/lib/admin/order-import/quote";
const input: ImportQuote["input"] = { checkoutSessionId: "same-retry-12345", lines: [{ sku: "MOP", qty: 1 }], shipping: { firstName: "Test", lastName: "Kupac", phone: "0600000000", street: "Test ulica", houseNumber: "2", city: "Jasenovik", postalCode: "18207", country: "RS" }, billingSameAsShipping: true, shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA", consent: true };
const request = (body: unknown, origin = "https://spc.test") => new NextRequest("https://spc.test/api/admin/erp/order-import", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.admin.mockResolvedValue({ id: "marko", role: "OPS" }); mocks.towns.mockResolvedValue([{ id: 123, name: "Jasenovik", displayName: null }]); });
afterEach(() => vi.unstubAllGlobals());
describe("operator import creation boundary", () => {
  it("reads a chat, searches by model, links the catalog product and sets operator defaults", async () => {
    mocks.products.mockResolvedValue([{ sku: "210007", name: "Rerna BAKE MASTER" }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ draft: {
      firstName: "Test", lastName: "Kupac", phone: "0600000000", email: "", street: "Test", houseNumber: "12", city: "Jasenovik", postalCode: "18207",
      paymentMethod: "", shippingMethod: "", lines: [{ name: "Mini rerna BAKE MASTER 12 L, 1200 W", sku: "", qty: 1, unitPrice: null }], deliveryAmount: null, totalAmount: null, warnings: [],
    } }))));
    const form = new FormData(); form.set("text", "Test prepiska");
    const response = await POST(new NextRequest("https://spc.test/api/admin/erp/order-import", { method: "POST", headers: { origin: "https://spc.test" }, body: form }));
    expect(response.status).toBe(200);
    const { draft } = await response.json();
    expect(draft).toMatchObject({ paymentMethod: "POUZECE_GOTOVINA", shippingMethod: "KURIR", postalCode: "18207", lines: [{ sku: "210007" }] });
    expect(draft.lines[0]).toMatchObject({ suggested: true, candidates: [{ sku: "210007", matchKind: "suggested" }] });
    expect(mocks.products.mock.calls[0][0].where).toEqual({ deletedAt: null, isActive: true });
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("resolves the courier town before signing a review and preserves it on create", async () => {
    mocks.createOrder.mockResolvedValue({ ok: true, data: { total: 998 } });
    const response = await POST(request({ action: "preview", input }));
    expect(response.status).toBe(200);
    const { quote } = await response.json();
    expect(mocks.createOrder.mock.calls[0][0].shipping.xExpressTownId).toBe(123);
    expect(mocks.createOrder.mock.calls[0][3].previewOnly).toBe(true);
    expect((await POST(request({ action: "create", quote, confirmed: true }))).status).toBe(200);
    expect(mocks.createOrder.mock.calls[1][0]).toEqual(mocks.createOrder.mock.calls[0][0]);
  });
  it.each([{ towns: [] }, { towns: [{ id: 1, name: "Jasenovik" }, { id: 2, name: "Jasenovik" }] }, { towns: [{ id: 1, name: "Drugo mesto" }] }])("blocks missing or ambiguous courier towns before preview or creation: %j", async ({ towns }) => {
    mocks.towns.mockResolvedValue(towns);
    expect((await POST(request({ action: "preview", input }))).status).toBe(400);
    const quote = signImportQuote({ input, actorId: "marko", expires: Date.now() + 60000, total: 998 }, "test-secret");
    const response = await POST(request({ action: "create", quote, confirmed: true }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("kurirskog adresara");
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated and cross-origin requests before creating anything", async () => {
    mocks.admin.mockResolvedValueOnce(null);
    expect((await POST(request({}))).status).toBe(401);
    expect((await POST(request({}, "https://attacker.test"))).status).toBe(403);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("accepts a unique exact town with omitted diacritics, and checks an operator-selected town", async () => {
    mocks.towns.mockResolvedValue([{ id: 456, name: "Žarkovo", displayName: null }]);
    mocks.createOrder.mockResolvedValue({ ok: true, data: { total: 1897 } });
    const shipping = { ...input.shipping, city: "Zarkovo", postalCode: "11030" };
    expect((await POST(request({ action: "preview", input: { ...input, shipping } }))).status).toBe(200);
    expect(mocks.createOrder.mock.calls[0][0].shipping.xExpressTownId).toBe(456);
    expect((await POST(request({ action: "preview", input: { ...input, shipping: { ...shipping, xExpressTownId: 456 } } }))).status).toBe(200);
    expect(mocks.towns.mock.calls[1][0].where).toEqual({ active: true, id: 456 });
    mocks.towns.mockResolvedValue([]);
    expect((await POST(request({ action: "preview", input: { ...input, shipping: { ...shipping, xExpressTownId: 456 } } }))).status).toBe(400);
  });
  it("does not require a courier dictionary for truck deliveries", async () => {
    mocks.createOrder.mockResolvedValue({ ok: true, data: { total: 998 } });
    expect((await POST(request({ action: "preview", input: { ...input, shippingMethod: "KAMION" } }))).status).toBe(200);
    expect(mocks.towns).not.toHaveBeenCalled();
  });
  it("requires operator confirmation and an unchanged signed review", async () => {
    const token = signImportQuote({ input, actorId: "marko", expires: Date.now() + 60000, total: 998 }, "test-secret");
    expect((await POST(request({ action: "create", quote: token, confirmed: false }))).status).toBe(400);
    expect((await POST(request({ action: "create", quote: token + "x", confirmed: true }))).status).toBe(400);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("uses reviewed input, total and retry ID on repeated creates; never client supplied totals", async () => {
    const token = signImportQuote({ input, actorId: "marko", expires: Date.now() + 60000, total: 998 }, "test-secret");
    mocks.createOrder.mockResolvedValue({ ok: true, data: { id: "order-id", number: "SPC-TEST" } });
    for (let i = 0; i < 2; i++) {
      expect((await POST(request({ action: "create", quote: token, confirmed: true, total: 1 }))).status).toBe(200);
    }
    expect(mocks.createOrder).toHaveBeenNthCalledWith(1, { ...input, shipping: { ...input.shipping, xExpressTownId: 123 } }, null, null, expect.objectContaining({ expectedTotal: 998, adminActorId: "marko", preserveCustomerPostalCode: true }));
    expect(mocks.createOrder.mock.calls[1][0].checkoutSessionId).toBe(mocks.createOrder.mock.calls[0][0].checkoutSessionId);
  });
});
