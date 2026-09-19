import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), getModule: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.authorize }));
vi.mock("@/lib/admin/erp", () => ({ getErpModule: mocks.getModule }));
import { GET } from "@/app/api/admin/erp/[module]/export/route";
describe("ERP export speculative requests", () => {
  it.each([{ "next-router-prefetch": "1" }, { purpose: "prefetch" }, { "sec-purpose": "prefetch;prerender" }])("does not build a workbook for %j", async (headers) => {
    const response = await GET(new Request("https://example.test/api/admin/erp/prodajni-nalozi/export", { headers }), { params: Promise.resolve({ module: "prodajni-nalozi" }) });
    expect(mocks.authorize).toHaveBeenCalledOnce();
    expect(mocks.getModule).not.toHaveBeenCalled();
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
