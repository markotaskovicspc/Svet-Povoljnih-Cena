import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ admin: vi.fn(), transaction: vi.fn(), audit: vi.fn(), finalize: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mock.transaction } }));
vi.mock("@/lib/auth/session", () => ({ getCurrentAdmin: mock.admin }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(path); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ logOperationalError: vi.fn() }));
vi.mock("@/lib/admin/audit", () => ({ logAudit: mock.audit, finalizeAudit: mock.finalize }));
vi.mock("@/lib/admin/picking.server", () => ({ getPickingSession: vi.fn() }));
vi.mock("@/lib/admin", async () => ({ withAdminState: (await import("@/lib/admin/guard")).withAdminState }));

import { recordPicking, finishPicking } from "@/app/admin/erp/preuzimanja/[id]/picking/actions";

beforeEach(() => {
  vi.clearAllMocks(); mock.audit.mockResolvedValue({ id: "audit" }); mock.finalize.mockResolvedValue(undefined);
});

describe("picking actions shared by ERP and the warehouse workspace", () => {
  it.each(["/admin/magacin", "/admin/erp/preuzimanja"])("allows the selected whole module %s through the real guard before input validation", async module => {
    mock.admin.mockResolvedValue({ id: "custom", role: "CUSTOM", accessPolicy: { version: 1, modules: [module] } });
    // Invalid inputs stop before business writes; reaching validation proves
    // warehouse-only users can invoke the shared actions without a second module.
    expect((await recordPicking({} as Parameters<typeof recordPicking>[0])).ok).toBe(false);
    expect((await finishPicking({} as Parameters<typeof finishPicking>[0])).ok).toBe(false);
    expect(mock.audit).toHaveBeenCalledTimes(2); expect(mock.transaction).not.toHaveBeenCalled();
  });

  it("denies an unrelated custom module before audit or DB work", async () => {
    mock.admin.mockResolvedValue({ id: "custom", role: "CUSTOM", accessPolicy: { version: 1, modules: ["/admin/erp/artikli"] } });
    await expect(recordPicking({} as Parameters<typeof recordPicking>[0])).rejects.toThrow("/admin/pristup-odbijen");
    await expect(finishPicking({} as Parameters<typeof finishPicking>[0])).rejects.toThrow("/admin/pristup-odbijen");
    expect(mock.audit).not.toHaveBeenCalled(); expect(mock.transaction).not.toHaveBeenCalled();
  });
});
