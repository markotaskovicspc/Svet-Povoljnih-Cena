import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ admin: vi.fn(), accounts: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { adminUser: { findMany: mock.accounts } } }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mock.admin,
  ADMIN_ROLE_LABEL: { CUSTOM: "Prilagođen pristup", WAREHOUSE: "Magacioner", CONTENT: "Sadržaj", OPS: "Operativa", ADS: "Marketing" },
}));
vi.mock("@/app/admin/erp/operativci/actions", () => ({
  createOperator: vi.fn(), setOperatorEnabled: vi.fn(), createStaffAccount: vi.fn(),
  updateStaffAccountAccess: vi.fn(), setStaffAccountEnabled: vi.fn(),
}));
vi.mock("@/components/admin/action-form", () => ({
  AdminActionForm: ({ children }: { children: ReactNode }) => createElement("form", null, children),
}));
vi.mock("@/components/admin/submit-button", () => ({
  SubmitButton: ({ children }: { children: ReactNode }) => createElement("button", null, children),
}));
vi.mock("@/components/admin/warehouse-login-link", () => ({ WarehouseLoginLink: () => null }));
vi.mock("@/components/admin/page-header", () => ({ PageHeader: ({ title }: { title: string }) => createElement("h1", null, title) }));

import OperatorsPage from "@/app/admin/erp/operativci/page";

beforeEach(() => { vi.clearAllMocks(); mock.accounts.mockResolvedValue([]); });

describe("staff controls on the existing warehouse account screen", () => {
  it("keeps OPS on the fixed warehouse workflow without custom permission controls", async () => {
    mock.admin.mockResolvedValue({ id: "ops", role: "OPS" });
    const html = renderToStaticMarkup(await OperatorsPage());
    expect(mock.admin).toHaveBeenCalledWith(["OPS"], "/admin/erp/operativci");
    expect(mock.accounts).toHaveBeenCalledWith(expect.objectContaining({ where: { role: "WAREHOUSE" } }));
    expect(html).toContain("Napravi nalog magacionera");
    expect(html).not.toContain('name="modules"');
    expect(html).not.toContain("Napravi korisnički nalog");
  });

  it("shows SUPER exact module choices and non-SUPER account editing", async () => {
    mock.admin.mockResolvedValue({ id: "super", role: "SUPER" });
    mock.accounts.mockResolvedValue([{ id: "custom", role: "CUSTOM", email: "staff@example.invalid", firstName: "Milan", lastName: "Test",
      accessPolicy: { version: 1, modules: ["/admin/viber"] }, enabled: true, lastLoginAt: null }]);
    const html = renderToStaticMarkup(await OperatorsPage());
    expect(mock.accounts).toHaveBeenCalledWith(expect.objectContaining({ where: { role: { not: "SUPER" } },
      select: expect.objectContaining({ role: true, accessPolicy: true }) }));
    expect(html).toContain("Napravi korisnički nalog");
    expect(html).toContain("Uredi pristup modulima (1)");
    expect(html).toContain("staff@example.invalid");
    expect(html).toContain('href="/admin/prijava"');
    expect(html).toContain('href="/admin/magacin/prijava"');
    expect(html).not.toContain('value="SUPER"');
    expect(html).not.toContain("passwordHash");
    expect(mock.accounts.mock.calls[0][0].select).not.toHaveProperty("passwordHash");
  });

  it("preselects the legacy warehouse grant when SUPER opens an existing account", async () => {
    mock.admin.mockResolvedValue({ id: "super", role: "SUPER" });
    mock.accounts.mockResolvedValue([{ id: "warehouse", role: "WAREHOUSE", email: "warehouse@example.invalid", firstName: "Milan", lastName: "Test",
      accessPolicy: null, enabled: true, lastLoginAt: null }]);
    const html = renderToStaticMarkup(await OperatorsPage());
    expect(html).toMatch(/<input(?=[^>]*name="modules")(?=[^>]*value="\/admin\/magacin")(?=[^>]*checked)[^>]*>/);
  });
});
