import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ admin: vi.fn(), shipment: vi.fn(), readiness: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentAdmin: mock.admin }));
vi.mock("@/lib/db", () => ({ db: { shipment: { findUnique: mock.shipment } } }));
vi.mock("@/lib/monitoring", () => ({ logOperationalError: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(path); } }));
vi.mock("@/lib/admin", async () => ({ requireAdminAction: (await import("@/lib/admin/guard")).requireAdminAction }));
vi.mock("@/lib/pdf/print-html", () => ({ renderPrintHtmlPdf: vi.fn() }));
vi.mock("@/lib/mygls", () => ({ downloadMyGlsLabelPdf: mock.download, MYGLS_PROVIDER: "MYGLS" }));
vi.mock("@/lib/payments/fulfillment-readiness", () => ({ fulfillmentPaymentReadiness: mock.readiness }));

import { GET } from "@/app/api/admin/shipments/[id]/label/route";
import { shipmentLabelPermissionModules } from "@/lib/admin/shipment-label-access";

const orders = "/admin/erp/prodajni-nalozi", picking = "/admin/erp/preuzimanja", claims = "/admin/erp/reklamacije-dnevnik";
const request = () => new Request("https://example.test/api/admin/shipments/shipment-1/label");
const context = () => ({ params: Promise.resolve({ id: "shipment-1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  mock.readiness.mockReturnValue({ ready: false, reason: "QA payment pending" });
});

describe("shared shipment label endpoint enforces its stored business purpose", () => {
  it.each([
    [claims, "ORDER_DELIVERY", false], [orders, "RECLAMATION_RETURN", false],
    [orders, "RECLAMATION_REPLACEMENT", false], [picking, "RECLAMATION_RETURN", false],
    [claims, "RECLAMATION_RETURN", true], [claims, "RECLAMATION_REPLACEMENT", true],
    [orders, "ORDER_DELIVERY", true], [picking, "ORDER_DELIVERY", true],
  ] as const)("%s with %s reaches only its permitted label workflow (%s)", async (module, purpose, permitted) => {
    mock.admin.mockResolvedValue({ id: "custom", role: "CUSTOM", accessPolicy: { version: 1, modules: [module] } });
    mock.shipment.mockResolvedValue({ id: "shipment-1", purpose, provider: "MYGLS", order: {
      paymentMethod: "UPLATA_NA_RACUN", payments: [{ status: "PENDING" }],
    } });
    const response = await GET(request(), context());
    expect(response.status).toBe(permitted ? 409 : 403);
    expect(mock.readiness).toHaveBeenCalledTimes(permitted ? 1 : 0);
    expect(mock.download).not.toHaveBeenCalled();
  });

  it("accepts an intentional combination of whole modules", async () => {
    mock.admin.mockResolvedValue({ id: "custom", role: "CUSTOM", accessPolicy: { version: 1, modules: [orders, claims] } });
    for (const purpose of ["ORDER_DELIVERY", "RECLAMATION_RETURN"]) {
      mock.shipment.mockResolvedValue({ id: "shipment-1", purpose, order: { paymentMethod: "UPLATA_NA_RACUN", payments: [] } });
      expect((await GET(request(), context())).status).toBe(409);
    }
  });

  it("preserves legacy OPS access to both workflows", async () => {
    mock.admin.mockResolvedValue({ id: "ops", role: "OPS", accessPolicy: null });
    for (const purpose of ["ORDER_DELIVERY", "RECLAMATION_REPLACEMENT"]) {
      mock.shipment.mockResolvedValue({ id: "shipment-1", purpose, order: { paymentMethod: "UPLATA_NA_RACUN", payments: [] } });
      expect((await GET(request(), context())).status).toBe(409);
    }
  });

  it("fails closed on a freshly revoked policy before reading a shipment", async () => {
    mock.admin.mockResolvedValue({ id: "custom", role: "CUSTOM", accessPolicy: { version: 1, modules: [] } });
    await expect(GET(request(), context())).rejects.toThrow("/admin/pristup-odbijen");
    expect(mock.shipment).not.toHaveBeenCalled();
  });

  it("does not assign an unknown stored purpose to a label module", () => {
    expect(shipmentLabelPermissionModules("UNKNOWN")).toEqual([]);
  });
});
