import { describe, expect, it } from "vitest";
import { adminModuleForPage, canAccessAdminModule, effectiveAdminModules, isWarehouseOnlyPolicy, parseAccessPolicy, permissionGroups } from "@/lib/admin/access-policy";
import { allowedNavFor } from "@/lib/admin/nav";

const policy = (...modules: string[]) => ({ version: 1, modules });
const custom = (...modules: string[]) => ({ role: "CUSTOM" as const, accessPolicy: policy(...modules) });

describe("admin module access policies", () => {
  it("allows marketing with the combined Viber/SMS module removed", () => {
    const marketing = permissionGroups.find(group => group.label === "Marketing")!;
    const user = custom(...marketing.modules.map(module => module.key).filter(key => key !== "/admin/viber"));
    expect(canAccessAdminModule(user, "/admin/newsletter", ["ADS"])).toBe(true);
    expect(canAccessAdminModule(user, "/admin/viber", ["ADS"])).toBe(false);
    const hrefs = allowedNavFor(user).flatMap(group => group.items.map(item => item.href));
    expect(hrefs).toContain("/admin/newsletter");
    expect(hrefs).not.toContain("/admin/viber");
    expect(hrefs).not.toContain("/admin/erp/prodajni-nalozi");
    expect(hrefs).toContain("/admin/erp");
  });
  it("combines modules across role boundaries without granting adjacent modules", () => {
    const user = custom("/admin/newsletter", "/admin/erp/porudzbenice");
    expect(canAccessAdminModule(user, "/admin/newsletter", ["ADS"])).toBe(true);
    expect(canAccessAdminModule(user, "/admin/erp/porudzbenice", ["OPS"])).toBe(true);
    expect(canAccessAdminModule(user, "/admin/erp/ulazne-fakture", ["OPS"])).toBe(false);
    expect(canAccessAdminModule(user, "/api/unknown", ["OPS"])).toBe(false);
    expect(canAccessAdminModule(user, undefined)).toBe(false);
  });
  it.each([null, {}, { version: 2, modules: ["/admin/viber"] }, policy(), policy("*"), policy("/admin/viber", "unknown"), { ...policy("/admin/viber"), wildcard: true }])("fails closed for missing, empty, malformed or unknown policy: %j", value => {
    const user = { role: "CUSTOM" as const, accessPolicy: value };
    expect(effectiveAdminModules(user)).toEqual([]);
    expect(canAccessAdminModule(user, "/admin/erp", ["OPS"])).toBe(false);
    expect(canAccessAdminModule(user, "/admin/viber", ["ADS"])).toBe(false);
  });
  it("uses the policy when present even on a legacy role, and protects SUPER-only operations", () => {
    expect(canAccessAdminModule({ role: "ADS", accessPolicy: policy("/admin/newsletter") }, "/admin/viber", ["ADS"])).toBe(false);
    expect(canAccessAdminModule(custom("/admin/newsletter"), "/admin/newsletter", ["SUPER"])).toBe(false);
    expect(parseAccessPolicy(policy("/admin/erp/operativci"))).toBeNull();
    expect(parseAccessPolicy(policy("/admin/erp/spcapp"))).toBeNull();
    expect(canAccessAdminModule({ role: "SUPER", accessPolicy: {} }, "/admin/erp/operativci", [])).toBe(true);
  });
  it("preserves legacy role checks and warehouse boundaries", () => {
    expect(canAccessAdminModule({ role: "ADS", accessPolicy: null }, undefined, ["ADS"])).toBe(true);
    expect(canAccessAdminModule({ role: "ADS" }, "/admin/erp/prodajni-nalozi", ["OPS"])).toBe(false);
    expect(canAccessAdminModule({ role: "WAREHOUSE" }, "/admin", undefined)).toBe(false);
    expect(canAccessAdminModule({ role: "WAREHOUSE" }, "/admin/magacin", ["WAREHOUSE", "OPS"])).toBe(true);
    expect(isWarehouseOnlyPolicy(policy("/admin/magacin") as { version: 1; modules: string[] })).toBe(true);
    expect(isWarehouseOnlyPolicy(policy("/admin/magacin", "/admin/newsletter") as { version: 1; modules: string[] })).toBe(false);
  });
  it("resolves page paths to the deepest module and rejects unknown pages", () => {
    expect(adminModuleForPage("/admin/erp/preuzimanja/povrati?x=1")).toBe("/admin/erp/preuzimanja/povrati");
    expect(adminModuleForPage("/admin/erp/artikli/123")).toBe("/admin/erp/artikli");
    expect(adminModuleForPage("/admin/magacin/picking/123")).toBe("/admin/magacin");
    expect(adminModuleForPage("/admin/unknown")).toBeNull();
    expect(parseAccessPolicy(policy("/admin/viber", "/admin/viber"))?.modules).toEqual(["/admin/viber"]);
  });
});
