import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ batches: vi.fn(), shipments: vi.fn(), module: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { pickupBatch: { findMany: mocks.batches }, shipment: { findMany: mocks.shipments } },
}));
vi.mock("@/lib/admin", () => ({ requireAdminAction: vi.fn() }));
vi.mock("@/lib/admin/erp", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/admin/erp")>(),
  getErpModule: mocks.module,
}));

import { getErpModuleDefinition } from "@/lib/admin/erp";
import { getOperationalErpRows } from "@/lib/admin/erp-operations";
import { GET as listRows } from "@/app/api/admin/erp/[module]/rows/route";
import { GET as exportRows } from "@/app/api/admin/erp/[module]/export/route";

const line = {
  lineGroupKey: "order:1", orderId: "order-1", orderItemId: "dc-item",
  purpose: "ORDER_DELIVERY", reclamationId: null, courierPickedUpAt: null,
};
const batch = {
  id: "batch-1", number: "PRE-2026-0012", provider: "X_EXPRESS", status: "BOOKED",
  createdAt: new Date("2026-09-15T09:00:00Z"), _count: { lines: 2 }, lines: [line, line],
};
const shipment = {
  orderId: "order-1", provider: "X_EXPRESS", purpose: "ORDER_DELIVERY", reclamationId: null,
  providerOrderId: "26-0001106899", providerShipmentId: "XE-SHIP-12", trackingNo: "XE-TRACK-12",
  providerParcelNumbers: ["XE-PARCEL-12", "XE-TRACK-12"],
  rawCreateResponse: { assignment: { orderItemIds: ["dc-item"], codAmount: 1000 } },
};
const context = () => ({ params: Promise.resolve({ module: "preuzimanja" }) });
const oldColumns = ["status", "number", "provider", "createdAt", "packages"];
function request(query: Record<string, string> = {}) {
  const params = new URLSearchParams({ columns: JSON.stringify(oldColumns), ...query });
  return new Request(`http://localhost/api/admin/erp/preuzimanja/rows?${params}`);
}

beforeEach(() => {
  mocks.batches.mockResolvedValue([batch]);
  mocks.shipments.mockResolvedValue([shipment]);
  mocks.module.mockImplementation(async () => ({
    ...getErpModuleDefinition("preuzimanja"), rows: await getOperationalErpRows("preuzimanja"),
  }));
});

describe("pickup-batch courier search", () => {
  it.each(["", "number", "courierNumbers"])("finds the screenshot number with search column '%s'", async (searchColumn) => {
    const result = await (await listRows(request({ q: "26-0001106899", searchColumn }), context())).json();
    expect(result.total).toBe(1);
    expect(result.rows[0].values.number).toBe("PRE-2026-0012");
    expect(result.rows[0].values.courierNumbers).toBe("26-0001106899, XE-SHIP-12, XE-TRACK-12, XE-PARCEL-12");
  });

  it.each(["  0001106899  ", "xe-ship-12", "XE-TRACK-12", "XE-PARCEL-12", "PRE-2026-0012"])("finds full and partial identifiers: %s", async (q) => {
    const result = await (await listRows(request({ q }), context())).json();
    expect(result.total).toBe(1);
  });

  it("keeps other selected columns and status filters scoped", async () => {
    const scoped = await (await listRows(request({ q: "26-0001106899", searchColumn: "provider" }), context())).json();
    expect(scoped.total).toBe(0);
    const filtered = await (await listRows(request({
      q: "26-0001106899", filters: JSON.stringify([{ columnKey: "status", operator: "equals", value: "Novi" }]),
    }), context())).json();
    expect(filtered.total).toBe(0);
  });

  it.each([
    { provider: "MYGLS" },
    { rawCreateResponse: { assignment: { orderItemIds: ["supplier-item"], codAmount: 0 } } },
    { purpose: "RECLAMATION_REPLACEMENT", reclamationId: "reclamation-other" },
    { orderId: "order-other" },
  ])("does not match an unrelated shipment: %j", async (override) => {
    mocks.shipments.mockResolvedValue([{ ...shipment, ...override }]);
    const result = await (await listRows(request({ q: "26-0001106899" }), context())).json();
    expect(result.total).toBe(0);
  });

  it("supports legacy whole-order shipments", async () => {
    mocks.shipments.mockResolvedValue([{ ...shipment, rawCreateResponse: null }]);
    const result = await (await listRows(request({ q: "26-0001106899" }), context())).json();
    expect(result.total).toBe(1);
  });

  it("matches replacement shipments only to their reclamation", async () => {
    const replacement = { purpose: "RECLAMATION_REPLACEMENT", reclamationId: "reclamation-1" };
    mocks.batches.mockResolvedValue([{ ...batch, lines: [{ ...line, ...replacement }] }]);
    mocks.shipments.mockResolvedValue([shipment, { ...shipment, ...replacement, providerOrderId: "XE-REPLACEMENT" }]);
    const found = await (await listRows(request({ q: "XE-REPLACEMENT" }), context())).json();
    expect(found.total).toBe(1);
    const unrelated = await (await listRows(request({ q: "26-0001106899" }), context())).json();
    expect(unrelated.total).toBe(0);
  });

  it("exports the same matching batch from a legacy saved view", async () => {
    const response = await exportRows(request({ q: "26-0001106899", searchColumn: "number" }), context());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(workbook.worksheets[0].getCell("B2").value).toBe("PRE-2026-0012");
  });
});
