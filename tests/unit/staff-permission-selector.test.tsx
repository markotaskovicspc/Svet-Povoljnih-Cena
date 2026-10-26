import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { permissionGroups } from "@/lib/admin/access-policy";
import { StaffPermissionSelector } from "@/components/admin/staff-permission-selector";

describe("staff module checkbox form", () => {
  it("renders celina controls and one individual submission checkbox per selectable module", () => {
    const html = renderToStaticMarkup(<StaffPermissionSelector />);
    expect(html.match(/name="modules"/g)).toHaveLength(permissionGroups.flatMap(group => group.modules).length);
    expect(html).toContain("Pristup celinama i modulima");
    for (const group of permissionGroups) expect(html).toContain(group.label);
    expect(html).not.toContain('value="SUPER"');
    expect(html).not.toContain('value="/admin/erp/operativci"');
    expect(html).not.toContain('name="role"');
  });

  it("preselects exact module identities across different celinas and marks partial groups", () => {
    const html = renderToStaticMarkup(<StaffPermissionSelector initialModules={["/admin/viber", "/admin/erp/artikli"]} />);
    expect(html).toMatch(/<input(?=[^>]*name="modules")(?=[^>]*value="\/admin\/viber")(?=[^>]*checked)[^>]*>/);
    expect(html).toMatch(/<input(?=[^>]*name="modules")(?=[^>]*value="\/admin\/erp\/artikli")(?=[^>]*checked)[^>]*>/);
    expect(html).toContain('aria-checked="mixed"');
    expect(html).toContain("Izabrano modula: 2");
  });

  it("offers Viber and SMS as a single module", () => {
    const html = renderToStaticMarkup(<StaffPermissionSelector />);
    expect(html.match(/value="\/admin\/viber"/g)).toHaveLength(1);
    expect(html).toContain("Viber i SMS");
  });
});
