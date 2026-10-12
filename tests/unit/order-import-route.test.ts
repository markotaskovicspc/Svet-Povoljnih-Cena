import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), createOrder: vi.fn(), audit: vi.fn(), products: vi.fn(), towns: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentAdmin: mocks.admin }));
vi.mock("@/lib/admin", () => ({ isAuthorized: (role: string) => ["OPS", "SUPER"].includes(role), logAudit: mocks.audit }));
vi.mock("@/lib/api/checkout", () => ({ createOrder: mocks.createOrder }));
vi.mock("@/lib/db", () => ({ db: { product: { findMany: mocks.products }, xExpressTown: { findMany: mocks.towns } } }));
vi.mock("@/lib/env", () => ({ envValue: () => "test-secret" }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimitForRequest: async () => ({ ok: true }), rateLimitJson: vi.fn() }));
import { GET, POST } from "@/app/api/admin/erp/order-import/route";
import { signImportQuote, type ImportQuote } from "@/lib/admin/order-import/quote";
const input: ImportQuote["input"] = { checkoutSessionId: "same-retry-12345", lines: [{ sku: "MOP", qty: 1 }], shipping: { firstName: "Test", lastName: "Kupac", phone: "0600000000", street: "Test ulica", houseNumber: "2", city: "Jasenovik", postalCode: "18207", country: "RS" }, billingSameAsShipping: true, shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA", consent: true };
const request = (body: unknown, origin = "https://spc.test") => new NextRequest("https://spc.test/api/admin/erp/order-import", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.admin.mockResolvedValue({ id: "marko", role: "OPS" }); mocks.towns.mockResolvedValue([{ id: 123, name: "Jasenovik", displayName: null, postalCode: "18207" }]); });
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
  it("prefills a verified locality and postal code when the chat provides no postcode", async () => {
    mocks.products.mockResolvedValue([]);
    mocks.towns.mockResolvedValue([{ id: 791113, name: "Beograd (Čukarica)", postalCode: "11030" }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ draft: {
      firstName: "Test", lastName: "Kupac", phone: "0600000000", email: "", street: "Test", houseNumber: "35", city: "ZARKOVO-BG", postalCode: "",
      paymentMethod: "", shippingMethod: "", lines: [], deliveryAmount: null, totalAmount: null, warnings: ["Nedostaje poštanski broj.", "Poštanski broj nije naveden.", "Proverite telefon."],
    } }))));
    const form = new FormData(); form.set("text", "Test adresa ZARKOVO-BG");
    const response = await POST(new NextRequest("https://spc.test/api/admin/erp/order-import", { method: "POST", headers: { origin: "https://spc.test" }, body: form }));
    expect(response.status).toBe(200);
    const { draft } = await response.json();
    expect(draft.warnings).toEqual(["Proverite telefon.", "Mesto i poštanski broj su dopunjeni: Žarkovo, 11030. Proverite adresu."]);
    expect(draft).toMatchObject({ city: "Žarkovo", postalCode: "11030", xExpressTownId: 791113 });
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
    expect((await response.json()).error).toContain("Mesto nije jednoznačno prepoznato");
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated and cross-origin requests before creating anything", async () => {
    mocks.admin.mockResolvedValueOnce(null);
    expect((await POST(request({}))).status).toBe(401);
    expect((await POST(request({}, "https://attacker.test"))).status).toBe(403);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("accepts a unique exact town with omitted diacritics, and checks an operator-selected town", async () => {
    mocks.towns.mockResolvedValue([{ id: 456, name: "Žarkovo", displayName: null, postalCode: "11030" }]);
    mocks.createOrder.mockResolvedValue({ ok: true, data: { total: 1897 } });
    const shipping = { ...input.shipping, city: "Zarkovo", postalCode: "11030" };
    expect((await POST(request({ action: "preview", input: { ...input, shipping } }))).status).toBe(200);
    expect(mocks.createOrder.mock.calls[0][0].shipping.xExpressTownId).toBe(456);
    expect((await POST(request({ action: "preview", input: { ...input, shipping: { ...shipping, city: "Žarkovo", xExpressTownId: 456 } } }))).status).toBe(200);
    expect(mocks.towns.mock.calls.at(-1)[0].where).toEqual({ active: true, id: 456 });
    mocks.towns.mockResolvedValue([]);
    expect((await POST(request({ action: "preview", input: { ...input, shipping: { ...shipping, city: "Žarkovo", xExpressTownId: 456 } } }))).status).toBe(400);
  });
  it("fills a missing postcode for any exact active town before schema validation", async () => {
    mocks.towns.mockResolvedValue([{ id: 777, name: "Niš", postalCode: "18000" }]);
    mocks.createOrder.mockResolvedValue({ ok: true, data: { total: 998 } });
    const response = await POST(request({ action: "preview", input: { ...input, shipping: { ...input.shipping, city: "НИШ", postalCode: "" } } }));
    expect(response.status).toBe(200);
    expect((await response.json()).shipping).toMatchObject({ city: "Niš", postalCode: "18000", xExpressTownId: 777 });
    expect(mocks.createOrder.mock.calls[0][3].previewOnly).toBe(true);
  });
  it("blocks a selected town whose address changed since the signed review", async () => {
    mocks.towns.mockResolvedValue([{ id: 123, name: "Jasenovik", postalCode: "99999" }]);
    const quote = signImportQuote({ input: { ...input, shipping: { ...input.shipping, xExpressTownId: 123 } }, actorId: "marko", expires: Date.now() + 60000, total: 998 }, "test-secret");
    expect((await POST(request({ action: "create", quote, confirmed: true }))).status).toBe(400);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("serves whole-dictionary suggestions only to authorized operators", async () => {
    mocks.towns.mockResolvedValue([{ id: 777, name: "Niš", postalCode: "18000" }]);
    const req = new NextRequest("https://spc.test/api/admin/erp/order-import?town=" + encodeURIComponent("НИШ"));
    expect(await (await GET(req)).json()).toMatchObject({ items: [{ townId: 777, name: "Niš", autoResolved: true }] });
    expect(mocks.towns.mock.calls[0][0]).toMatchObject({ where: { active: true }, select: { postalCode: true } });
    mocks.admin.mockResolvedValue(null);
    expect((await GET(req)).status).toBe(401);
    expect(mocks.products).not.toHaveBeenCalled();
  });
  it("binds the operator loyalty choice to the signed preview and reuses it on create", async () => {
    mocks.createOrder.mockResolvedValue({ ok: true, data: { total: 700 } });
    const preview = await POST(request({ action: "preview", input, staffLoyalty: true }));
    expect(preview.status).toBe(200);
    const { quote } = await preview.json();
    expect(mocks.createOrder.mock.calls[0][3]).toMatchObject({ previewOnly: true, staffLoyalty: true, adminActorId: "marko" });
    expect((await POST(request({ action: "create", quote, confirmed: true, staffLoyalty: false }))).status).toBe(200);
    expect(mocks.createOrder.mock.calls[1][3]).toMatchObject({ staffLoyalty: true, expectedTotal: 700, adminActorId: "marko" });
    expect(mocks.createOrder.mock.calls[1][1]).toBeNull();
    expect(mocks.createOrder.mock.calls[1][2]).toBeNull();
  });
  it("does not treat a client supplied string as permission for loyalty prices", async () => {
    expect((await POST(request({ action: "preview", input, staffLoyalty: "true" }))).status).toBe(400);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("does not require a courier dictionary for truck deliveries", async () => {
    mocks.createOrder.mockResolvedValue({ ok: true, data: { total: 998 } });
    expect((await POST(request({ action: "preview", input: { ...input, shippingMethod: "KAMION" } }))).status).toBe(200);
    expect(mocks.towns).not.toHaveBeenCalled();
  });
  it("resolves the photographed Žarkovo locality through its verified active routing town", async () => {
    mocks.towns.mockResolvedValue([{ id: 791113, name: "Beograd (Čukarica)", postalCode: "11030" }]);
    mocks.createOrder.mockResolvedValue({ ok: true, data: { total: 1897 } });
    expect((await POST(request({ action: "preview", input: { ...input, shipping: { ...input.shipping, city: "Zarkovo BG", postalCode: "11030" } } }))).status).toBe(200);
    expect(mocks.createOrder.mock.calls[0][0].shipping.xExpressTownId).toBe(791113);
    expect(mocks.towns.mock.calls[0][0].where).toEqual({ active: true });
  });
  it("corrects the photographed exact locality's inferred postal code and returns it for review", async () => {
    mocks.towns.mockResolvedValue([{ id: 791113, name: "Beograd (Čukarica)", postalCode: "11030" }]);
    mocks.createOrder.mockResolvedValue({ ok: true, data: { total: 1897 } });
    const response = await POST(request({ action: "preview", input: { ...input, shipping: { ...input.shipping, city: "ZARKOVO-BG", postalCode: "11000" } } }));
    expect(response.status).toBe(200);
    expect((await response.json()).shipping).toMatchObject({ city: "Žarkovo", postalCode: "11030", xExpressTownId: 791113 });
    expect(mocks.createOrder).toHaveBeenCalledWith(expect.objectContaining({ shipping: expect.objectContaining({ city: "Žarkovo", postalCode: "11030" }) }), null, null, expect.objectContaining({ previewOnly: true }));
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
