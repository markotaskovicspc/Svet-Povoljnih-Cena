import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), preview: vi.fn(), apply: vi.fn(), revalidate: vi.fn(), token: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { $transaction: async (callback: (tx: object) => unknown) => callback({}) } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/admin/purchase-price-import.server", () => ({ readPurchasePriceImportFile: mocks.read, previewPurchasePriceImport: mocks.preview, applyPurchasePriceImport: mocks.apply }));
vi.mock("@/lib/admin/inventory-import-token", () => ({ createInventoryImportToken: mocks.token }));
import { GET, POST } from "@/app/api/admin/erp/nabavne-cene/import/route";

function request(action = "preview", token?: string, headers?: Record<string, string>) {
  const body = new FormData(); body.set("action", action); body.set("file", new File(["SKU;price"], "prices.csv")); if (token) body.set("token", token);
  return new Request("https://spc.test/api/admin/erp/nabavne-cene/import", { method: "POST", body, headers });
}

describe("purchase price import HTTP boundary", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ id: "admin-1" }); mocks.read.mockResolvedValue({ rows: [{ sku: "A" }], fileHash: "hash" });
    mocks.preview.mockResolvedValue({ rows: [], stateHash: "state", valid: true, products: [{ privateField: "hidden" }] });
    mocks.token.mockReturnValue("signed-token"); mocks.apply.mockResolvedValue({ count: 1 });
  });
  it("requires OPS permission on preview, apply and template before reading or writing", async () => {
    const denied = new Error("NEXT_REDIRECT"); mocks.auth.mockRejectedValue(denied);
    await expect(POST(request())).rejects.toBe(denied);
    await expect(POST(request("apply", "token"))).rejects.toBe(denied);
    await expect(GET()).rejects.toBe(denied);
    expect(mocks.auth).toHaveBeenCalledWith(["OPS"], "/admin/erp/nabavne-cene");
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("rejects a foreign origin and oversized request before parsing", async () => {
    expect((await POST(request("preview", undefined, { origin: "https://evil.test" }))).status).toBe(403);
    expect((await POST(request("preview", undefined, { "content-length": "9999999" }))).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("accepts the browser Host when Next rewrites the internal URL to localhost", async () => {
    const original = request("preview", undefined, { origin: "http://127.0.0.1:3041", host: "127.0.0.1:3041" });
    const internal = new Request("http://localhost:3041/api/admin/erp/nabavne-cene/import", { method: "POST", body: await original.arrayBuffer(), headers: original.headers });
    expect((await POST(internal)).status).toBe(200);
  });
  it("does not allow a client-supplied forwarded-host to bypass origin validation", async () => {
    expect((await POST(request("preview", undefined, { origin: "https://evil.test", host: "spc.test", "x-forwarded-host": "evil.test" }))).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("returns signed preview with no writes and hides internal product snapshot", async () => {
    const result = await POST(request());
    expect(await result.json()).toEqual({ ok: true, rows: [], stateHash: "state", valid: true, token: "signed-token" });
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.token).toHaveBeenCalledWith({ adminId: "purchase-prices:admin-1", fileHash: "hash", stateHash: "state" });
  });
  it("does not issue a token for invalid rows and rejects apply without preview token", async () => {
    mocks.preview.mockResolvedValue({ rows: [], stateHash: "state", valid: false, products: [] });
    expect((await (await POST(request())).json()).token).toBeNull();
    expect((await POST(request("apply"))).status).toBe(400);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("passes the original file, token and authenticated admin to apply and refreshes prices", async () => {
    expect(await (await POST(request("apply", "signed-token"))).json()).toEqual({ ok: true, count: 1 });
    expect(mocks.apply).toHaveBeenCalledWith({ rows: [{ sku: "A" }], fileHash: "hash", token: "signed-token", adminId: "admin-1" });
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/erp/nabavne-cene");
  });
  it("provides an empty UTF-8 CSV template with all supported columns", async () => {
    const response = await GET();
    expect(response.headers.get("content-disposition")).toContain("nabavne-cene-sablon.csv");
    expect(await response.text()).toContain("Šifra;Nabavna cena;Važenje od;Važenje do;Valuta;Dobavljač");
  });
});
