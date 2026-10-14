import { describe, expect, it } from "vitest";
import { adminLoginDestination } from "@/lib/admin/login-destination";
describe("admin account switching", () => {
  it("sends super admins and operations to ERP after using the warehouse login", () => {
    expect(adminLoginDestination("SUPER", "/admin/magacin")).toBe("/admin/erp");
    expect(adminLoginDestination("OPS", "/admin/magacin")).toBe("/admin/erp");
    expect(adminLoginDestination("SUPER", "/admin/magacin?q=PRE1")).toBe("/admin/erp");
  });
  it("keeps warehouse users in their permitted interface", () => {
    expect(adminLoginDestination("WAREHOUSE", "/admin/erp/artikli")).toBe("/admin/magacin");
    expect(adminLoginDestination("WAREHOUSE", "/admin/magacin/picking/123")).toBe("/admin/magacin/picking/123");
  });
  it("preserves explicit admin destinations and permitted warehouse detail links", () => {
    expect(adminLoginDestination("SUPER", "/admin/erp/artikli?q=abc")).toBe("/admin/erp/artikli?q=abc");
    expect(adminLoginDestination("SUPER", "/admin/magacin/picking/123")).toBe("/admin/magacin/picking/123");
    expect(adminLoginDestination("SALES", "/admin/magacin/picking/123")).toBe("/admin/erp");
  });
  it.each(["https://evil.invalid/admin", "//evil.invalid/admin", "/admin/../outside", "/administrator", "/admin/prijava", "/admin/magacin/prijava"])("rejects unsafe or looping callback %s", callback => {
    expect(adminLoginDestination("SUPER", callback)).toBe("/admin/erp");
  });
});
