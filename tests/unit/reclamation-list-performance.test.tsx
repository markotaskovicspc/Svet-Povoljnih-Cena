import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), sign: vi.fn(), module: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { reclamation: { findMany: mocks.list }, $queryRaw: vi.fn(async () => []) } }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: vi.fn(), withAdminState: vi.fn() }));
vi.mock("@/lib/admin/erp", () => ({ getErpModule: mocks.module }));
vi.mock("@/lib/api/uploads", () => ({ signReclamationPhotoUrls: mocks.sign }));
vi.mock("@/lib/api/reclamations", () => ({}));
vi.mock("@/components/admin/erp-grid", () => ({ ErpGrid: () => null }));
vi.mock("@/components/admin/reclamation-order-search", () => ({ ReclamationOrderFields: () => null }));
vi.mock("@/components/admin/action-form", () => ({ AdminActionForm: ({ children }: { children: ReactNode }) => <form>{children}</form> }));
vi.mock("next/image", () => ({ default: () => <span>Fotografija</span> }));

import ReclamationsPage from "@/app/admin/erp/reklamacije-dnevnik/page";

// The journal list moved to the ERP grid (loaded page by page); the page itself only
// renders the header, KPI strip and manual-entry dialog and must not preload claims or photos.
it("renders the grid shell without preloading claims, photos, shipments or history", async () => {
  mocks.module.mockResolvedValue(null);
  const html = renderToStaticMarkup(await ReclamationsPage());
  expect(html).toContain("Dnevnik reklamacija");
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
  expect(html).not.toContain("Sačuvaj magacin");
});
