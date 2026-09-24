import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  batch: vi.fn(), orders: vi.fn(), shipments: vi.fn(), admin: vi.fn(),
  download: vi.fn(), merge: vi.fn(), render: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  pickupBatch: { findUnique: mocks.batch },
  order: { findMany: mocks.orders },
  shipment: { findMany: mocks.shipments },
} }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.admin }));
vi.mock("@/lib/mygls", () => ({ MYGLS_PROVIDER: "MYGLS", downloadMyGlsLabelPdf: mocks.download }));
vi.mock("@/lib/mygls/print-layout", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/mygls/print-layout")>(),
  packMyGlsLabels: mocks.merge,
}));
vi.mock("@/lib/x-express/labels", () => ({ renderXExpressBatchLabelsHtml: mocks.render }));

import { GET } from "@/app/api/admin/erp/preuzimanja/[id]/labels/route";
import { MyGlsPrintLayoutError } from "@/lib/mygls/print-layout";

function line(orderId: string, packageNo = 1, deferredAt: Date | null = null) {
  return {
    orderId, orderItemId: `${orderId}-item`, reclamationId: null,
    purpose: "ORDER_DELIVERY" as const, lineGroupKey: `order:${orderId}`,
    packageNo, deferredAt, orderItem: { name: orderId },
  };
}
function shipment(orderId: string, packageCount = 1) {
  return {
    id: `shipment-${orderId}`, orderId, reclamationId: null,
    purpose: "ORDER_DELIVERY", rawCreateResponse: null,
    labelObjectKey: `${orderId}.pdf`, packageCount,
  };
}
let lines: ReturnType<typeof line>[];
let provider: string;
let unpaidOrderIds: string[];
const request = () => GET(new Request("https://example.test/api/admin/erp/preuzimanja/batch/labels"), {
  params: Promise.resolve({ id: "batch" }),
});

beforeEach(() => {
  vi.resetAllMocks();
  provider = "MYGLS";
  unpaidOrderIds = [];
  // Production incident: eight active packages and a fully deferred two-chair group.
  lines = [
    ...Array.from({ length: 4 }, (_, i) => line("large-order", i + 1)),
    ...Array.from({ length: 4 }, (_, i) => line(`order-${i}`)),
    line("deferred-chairs", 1, new Date()), line("deferred-chairs", 2, new Date()),
  ];
  // Model Prisma's relation filter, so removing the route's filter reproduces the bug.
  mocks.batch.mockImplementation(async (query) => ({
    id: "batch", number: "PRE-2026-0039", provider, labelsCreatedAt: new Date(),
    lines: query.select.lines.where?.deferredAt === null
      ? lines.filter((row) => row.deferredAt === null) : lines,
  }));
  mocks.orders.mockImplementation(async (query) => query.where.id.in.map((id: string) => ({
    number: id,
    paymentMethod: unpaidOrderIds.includes(id) ? "UPLATA_NA_RACUN" : "POUZECE_GOTOVINA",
    payments: [],
  })));
  mocks.shipments.mockResolvedValue([
    shipment("large-order", 4), ...Array.from({ length: 4 }, (_, i) => shipment(`order-${i}`)),
  ]);
  mocks.download.mockImplementation(async (key: string) => Buffer.from(key));
  mocks.merge.mockResolvedValue(Buffer.from("%PDF-1.7\n"));
  mocks.render.mockReturnValue("<html>active labels</html>");
});

describe("pickup label downloads", () => {
  it("does not reuse the old address label for replacement goods", async () => {
    lines = [{ ...line("order"), lineGroupKey: "reshipment:r" }];
    mocks.shipments.mockResolvedValue([shipment("order")]);
    expect((await request()).status).toBe(409);
    expect(mocks.download).not.toHaveBeenCalled();
    mocks.shipments.mockResolvedValue([{ ...shipment("order"), labelObjectKey: "new.pdf", rawCreateResponse: { assignment: { orderItemIds: ["order-item"], assignmentKey: "reshipment:r", codAmount: 0 } } }]);
    expect((await request()).status).toBe(200);
    expect(mocks.download).toHaveBeenCalledWith("new.pdf");
  });

  it("preserves the historical batch's label when a replacement shipment exists", async () => {
    lines = [line("order")];
    mocks.shipments.mockResolvedValue([
      { ...shipment("order"), id: "new", labelObjectKey: "new.pdf", rawCreateResponse: { assignment: { orderItemIds: ["order-item"], assignmentKey: "reshipment:r", codAmount: 0 } } },
      shipment("order"),
    ]);
    expect((await request()).status).toBe(200);
    expect(mocks.download.mock.calls).toEqual([["order.pdf"]]);
  });
  it.each(["MYGLS", "X_EXPRESS"])("prints eight active packages without the deferred group (%s)", async (courier) => {
    provider = courier;
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-courier-label-count")).toBe("8");
    expect(mocks.orders.mock.calls[0][0].where.id.in).not.toContain("deferred-chairs");
    if (courier === "MYGLS") {
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(mocks.download).toHaveBeenCalledTimes(5);
      expect(mocks.download).not.toHaveBeenCalledWith("deferred-chairs.pdf");
      expect(mocks.merge.mock.calls[0][0]).toEqual([
        { bytes: Buffer.from("large-order.pdf"), packageCount: 4, groupKey: "large-order:ORDER_DELIVERY:" },
        ...Array.from({ length: 4 }, (_, i) => ({ bytes: Buffer.from(`order-${i}.pdf`), packageCount: 1, groupKey: `order-${i}:ORDER_DELIVERY:` })),
      ]);
    } else {
      expect(mocks.render.mock.calls[0][0]).toHaveLength(5);
      expect(mocks.render.mock.calls[0][1].packageContentsByShipmentId["shipment-large-order"]).toHaveLength(4);
    }
  });

  it("explains an unsupported GLS layout instead of returning a partial batch", async () => {
    mocks.merge.mockRejectedValue(new MyGlsPrintLayoutError("Nepoznat GLS raspored"));
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Nepoznat GLS raspored");
  });

  it("does not require payment for a fully deferred order", async () => {
    unpaidOrderIds = ["deferred-chairs"];
    expect((await request()).status).toBe(200);
  });

  it("does not count a deferred package within an otherwise active group", async () => {
    lines = [line("large-order"), line("large-order", 2, new Date())];
    mocks.shipments.mockResolvedValue([shipment("large-order")]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-courier-label-count")).toBe("1");
  });

  it("does not print a deferred group's label even if a shipment still exists", async () => {
    lines = [line("active"), line("deferred", 1, new Date())];
    mocks.shipments.mockResolvedValue([shipment("active"), shipment("deferred")]);
    expect((await request()).status).toBe(200);
    expect(mocks.download.mock.calls).toEqual([["active.pdf"]]);
  });

  it("returns a clear conflict when every package is deferred", async () => {
    lines = [line("deferred", 1, new Date())];
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Nalog nema aktivne pakete za štampu.");
    expect(mocks.shipments).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("still blocks a genuinely missing active group's label", async () => {
    lines = [line("missing"), line("deferred", 1, new Date())];
    mocks.shipments.mockResolvedValue([]);
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Nedostaju kurirske adresnice za 1 picking grupa");
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("still blocks an incomplete label count for active packages", async () => {
    lines = [line("active"), line("active", 2), line("deferred", 1, new Date())];
    mocks.shipments.mockResolvedValue([shipment("active")]);
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Pronađeno je 1 od 2 potrebnih");
  });

  it("still requires confirmed payment for active orders", async () => {
    unpaidOrderIds = ["large-order"];
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("plaćanje nije potvrđeno");
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("still requires admin authorization", async () => {
    mocks.admin.mockRejectedValue(new Error("Unauthorized"));
    await expect(request()).rejects.toThrow("Unauthorized");
    expect(mocks.batch).not.toHaveBeenCalled();
  });
});
