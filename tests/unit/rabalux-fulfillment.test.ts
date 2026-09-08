import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fulfillmentFindUnique: vi.fn(),
  fulfillmentUpdateMany: vi.fn(),
  shipmentFindUnique: vi.fn(),
  createShipmentForOrder: vi.fn(),
  trackedDispatch: vi.fn(),
  downloadMyGlsLabelPdf: vi.fn(),
  enqueueBackgroundJob: vi.fn(),
  renderPrintHtmlPdf: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    supplierFulfillment: {
      findUnique: mocks.fulfillmentFindUnique,
      updateMany: mocks.fulfillmentUpdateMany,
    },
    shipment: { findUnique: mocks.shipmentFindUnique },
  },
}));
vi.mock("@/lib/email", () => ({ trackedDispatch: mocks.trackedDispatch }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: mocks.enqueueBackgroundJob }));
vi.mock("@/lib/api/uploads", () => ({ signReclamationPhotoUrls: vi.fn() }));
vi.mock("@/lib/channel-availability.server", () => ({
  syncProductChannelAvailability: vi.fn(),
}));
vi.mock("@/lib/rabalux/config", () => ({
  isRabaluxSupplierOperational: () => true,
}));
vi.mock("@/lib/courier/registry", () => ({
  createShipmentForOrder: mocks.createShipmentForOrder,
}));
vi.mock("@/lib/mygls", () => ({
  MYGLS_PROVIDER: "MYGLS",
  downloadMyGlsLabelPdf: mocks.downloadMyGlsLabelPdf,
}));
vi.mock("@/lib/x-express/config", () => ({ X_EXPRESS_PROVIDER: "X_EXPRESS" }));
vi.mock("@/lib/x-express/labels", () => ({
  renderXExpressLabelsHtml: vi.fn().mockReturnValue("<html>Test label</html>"),
}));
vi.mock("@/lib/pdf/print-html", () => ({
  renderPrintHtmlPdf: mocks.renderPrintHtmlPdf,
}));

import {
  sendSupplierOrderEmail,
  sendSupplierShippingDocumentsEmail,
} from "@/lib/rabalux/fulfillment";

const fulfillment = {
  id: "fulfillment-1",
  status: "PENDING",
  sentAt: new Date("2026-09-04T10:01:00.000Z"),
  supplier: {
    name: "Rabalux",
    email: "warehouse@rabalux.example",
    integrationKey: "RABALUX",
    enabled: true,
  },
  order: {
    id: "order-1",
    createdAt: new Date("2026-09-04T10:00:00.000Z"),
    number: "SPC-2026-000123",
    total: 12_999,
    paymentMethod: "POUZECE_GOTOVINA",
    shippingMethod: "KURIR",
    payments: [],
    items: [{ id: "item-1" }],
  },
  items: [
    {
      externalSku: "7996",
      qty: 1,
      orderItem: { id: "item-1", name: "Rabalux plafonjera" },
    },
  ],
};

const initialOrderFulfillment = {
  id: "fulfillment-order-1",
  status: "PENDING",
  sentAt: null,
  supplier: fulfillment.supplier,
  order: {
    number: "SPC-2026-000124",
    createdAt: new Date("2026-09-04T10:00:00.000Z"),
    billingSameAsShipping: true,
    shipFirstName: "Test",
    shipLastName: "Kupac",
    shipPhone: "0601234567",
    shipStreet: "Test ulica 1",
    shipCity: "Beograd",
    shipPostalCode: "11000",
    shipCompanyName: null,
    shipPib: null,
    billFirstName: null,
    billLastName: null,
    billStreet: null,
    billCity: null,
    billPostalCode: null,
    billCompanyName: null,
    billPib: null,
  },
  items: [
    {
      externalSku: "7996",
      qty: 1,
      orderItem: { name: "Rabalux plafonjera" },
    },
  ],
};

describe("Rabalux initial order email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fulfillmentFindUnique.mockResolvedValue(initialOrderFulfillment);
    mocks.fulfillmentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.trackedDispatch.mockResolvedValue({
      ok: true,
      id: "email-order-1",
      provider: "none",
    });
  });

  it("recovers courier scheduling after a successful resend of an old COD order", async () => {
    mocks.fulfillmentFindUnique.mockResolvedValue({
      ...initialOrderFulfillment,
      order: { ...initialOrderFulfillment.order, shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA", payments: [] },
    });
    await sendSupplierOrderEmail({ fulfillmentId: initialOrderFulfillment.id, dispatchKey: "admin-retry" });
    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith({
      kind: "SUPPLIER_SHIPPING_DOCUMENTS_EMAIL",
      payload: { fulfillmentId: initialOrderFulfillment.id, dispatchKey: "admin-retry" },
      idempotencyKey: `supplier-shipping-documents:${initialOrderFulfillment.id}:admin-retry`,
    });
  });

  it("sends immediately with only Rabalux items and the two supplier-safe PDFs", async () => {
    await expect(
      sendSupplierOrderEmail({
        fulfillmentId: initialOrderFulfillment.id,
        dispatchKey: "checkout",
      }),
    ).resolves.toMatchObject({ skipped: null });

    expect(mocks.createShipmentForOrder).not.toHaveBeenCalled();
    expect(mocks.trackedDispatch).toHaveBeenCalledTimes(1);
    const dispatch = mocks.trackedDispatch.mock.calls[0]![0];
    expect(dispatch.kind).toBe("supplier_order");
    expect(dispatch.subject).toContain("priprema artikala");
    expect(dispatch.text).toContain("7996 | Rabalux plafonjera × 1");
    expect(dispatch.text).toContain("mesto preuzimanja");
    expect(
      dispatch.attachments.map((item: { filename: string }) => item.filename),
    ).toEqual([
      "predracun-rabalux-SPC-2026-000124.pdf",
      "obrazac-za-odustajanje-SPC-2026-000124.pdf",
    ]);
    const serialized = JSON.stringify(dispatch);
    expect(serialized).not.toMatch(/12[.,]?999|1[.,]?500|DC-ARTIKAL/i);
    expect(mocks.fulfillmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT", lastError: null }),
      }),
    );
  });
});

describe("Rabalux COD courier fulfillment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fulfillmentFindUnique.mockResolvedValue(fulfillment);
    mocks.fulfillmentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.createShipmentForOrder.mockResolvedValue({
      id: "shipment-1",
      provider: "X_EXPRESS",
      providerShipmentId: "provider-shipment-1",
      trackingNo: "MYGLS-123",
    });
    mocks.shipmentFindUnique.mockResolvedValue({
      id: "shipment-1",
      provider: "X_EXPRESS",
      labelObjectKey: "mygls/SPC-2026-000123/shipment-1.pdf",
      labelMimeType: "application/pdf",
      order: {
        number: fulfillment.order.number,
        total: fulfillment.order.total,
        paymentMethod: fulfillment.order.paymentMethod,
        shipFirstName: "Test",
        shipLastName: "Kupac",
        shipPhone: "0601234567",
        shipStreet: "Test ulica 1",
        shipCity: "Beograd",
        shipPostalCode: "11000",
        notes: null,
        items: [{ name: "Rabalux plafonjera", qty: 1 }],
      },
    });
    mocks.downloadMyGlsLabelPdf.mockResolvedValue(Buffer.from("%PDF-label"));
    mocks.renderPrintHtmlPdf.mockResolvedValue(Buffer.from("%PDF-x-express-label"));
    mocks.trackedDispatch.mockResolvedValue({
      ok: true,
      id: "email-1",
      provider: "none",
    });
  });

  it("creates one assigned shipment and sends only its waybill and packing list", async () => {
    await expect(
      sendSupplierShippingDocumentsEmail({
        fulfillmentId: fulfillment.id,
        dispatchKey: "checkout",
      }),
    ).resolves.toMatchObject({
      skipped: null,
      shipmentId: "shipment-1",
    });

    expect(mocks.createShipmentForOrder).toHaveBeenCalledTimes(1);
    expect(mocks.createShipmentForOrder).toHaveBeenCalledWith("order-1", {
      orderItemIds: ["item-1"],
      supplierFulfillmentId: "fulfillment-1",
      provider: "X_EXPRESS",
      codAmount: 12_999,
      announceXExpress: false,
    });
    expect(mocks.trackedDispatch).toHaveBeenCalledTimes(1);
    const dispatch = mocks.trackedDispatch.mock.calls[0]![0];
    expect(dispatch.idempotencyKey).toBe(
      "supplier-shipping-documents:fulfillment-1:checkout",
    );
    expect(dispatch.subject).toContain("Adresnica i kurirski nalog");
    expect(dispatch.text).toContain("preuzimanje robe na Rabalux adresi");
    expect(
      dispatch.attachments.map((item: { filename: string }) => item.filename),
    ).toEqual([
      "adresnica-SPC-2026-000123.pdf",
      "pak-lista-SPC-2026-000123.pdf",
    ]);
    expect(mocks.renderPrintHtmlPdf).toHaveBeenCalledWith("<html>Test label</html>");
    expect(dispatch.attachments[0].contentType).toBe("application/pdf");
    expect(Buffer.from(dispatch.attachments[0].content, "base64").toString()).toBe("%PDF-x-express-label");
    expect(JSON.stringify(dispatch)).not.toMatch(
      /predračun|predracun|garantni-list|12[.,]?999/i,
    );
    expect(dispatch.metadata).toMatchObject({
      attachmentCount: 2,
      supplierItemCount: 1,
      shipmentId: "shipment-1",
      provider: "X_EXPRESS",
      courierRequestAccepted: true,
      codCollectionPlan: "RABALUX_FULL_ORDER",
    });
    expect(mocks.fulfillmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PICKUP_READY",
          lastError: null,
        }),
      }),
    );
  });

  it("records a PDF failure for retry without sending an HTML fallback", async () => {
    mocks.renderPrintHtmlPdf.mockRejectedValue(new Error("PDF rendering failed"));
    await expect(sendSupplierShippingDocumentsEmail({
      fulfillmentId: fulfillment.id,
      dispatchKey: "checkout",
    })).rejects.toThrow("PDF rendering failed");
    expect(mocks.trackedDispatch).not.toHaveBeenCalled();
    expect(mocks.fulfillmentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "FAILED", lastError: "PDF rendering failed" },
    }));
  });

  it("keeps the full COD on the DC parcel for a mixed order and hides it from Rabalux", async () => {
    mocks.fulfillmentFindUnique.mockResolvedValue({
      ...fulfillment,
      order: {
        ...fulfillment.order,
        items: [{ id: "item-1" }, { id: "item-dc" }],
      },
    });

    await sendSupplierShippingDocumentsEmail({
      fulfillmentId: fulfillment.id,
      dispatchKey: "checkout",
    });

    expect(mocks.createShipmentForOrder).toHaveBeenCalledWith("order-1", {
      orderItemIds: ["item-1"],
      supplierFulfillmentId: "fulfillment-1",
      provider: "X_EXPRESS",
      codAmount: 0,
      announceXExpress: false,
    });
    const dispatch = mocks.trackedDispatch.mock.calls[0]![0];
    expect(dispatch.metadata).toMatchObject({
      codCollectionPlan: "DC_FULL_ORDER",
      supplierItemCount: 1,
    });
    expect(JSON.stringify(dispatch)).not.toMatch(/12[.,]?999|item-dc/i);
  });

  it("defers today's order without contacting the supplier or courier", async () => {
    mocks.fulfillmentFindUnique.mockResolvedValue({
      ...fulfillment,
      order: { ...fulfillment.order, createdAt: new Date() },
    });
    await expect(sendSupplierShippingDocumentsEmail({ fulfillmentId: fulfillment.id }))
      .rejects.toMatchObject({ name: "BackgroundJobDeferredError" });
    expect(mocks.createShipmentForOrder).not.toHaveBeenCalled();
    expect(mocks.trackedDispatch).not.toHaveBeenCalled();
    expect(mocks.fulfillmentUpdateMany).not.toHaveBeenCalled();
  });

  it("keeps COD on the DC when one SKU is split between both warehouses", async () => {
    mocks.fulfillmentFindUnique.mockResolvedValue({
      ...fulfillment,
      order: { ...fulfillment.order, items: [{ id: "item-1", warehouseReservedQty: 1 }] },
    });
    await sendSupplierShippingDocumentsEmail({ fulfillmentId: fulfillment.id });
    expect(mocks.createShipmentForOrder).toHaveBeenCalledWith("order-1",
      expect.objectContaining({ codAmount: 0, provider: "X_EXPRESS" }));
  });

  it("does not create a courier request before the initial Rabalux order email succeeds", async () => {
    mocks.fulfillmentFindUnique.mockResolvedValue({
      ...fulfillment,
      status: "PENDING",
      sentAt: null,
    });

    await expect(
      sendSupplierShippingDocumentsEmail({
        fulfillmentId: fulfillment.id,
        dispatchKey: "checkout",
      }),
    ).rejects.toThrow(/porudžbina još nije uspešno poslata/i);

    expect(mocks.createShipmentForOrder).not.toHaveBeenCalled();
    expect(mocks.trackedDispatch).not.toHaveBeenCalled();
  });

  it("uses the same idempotency key and assigned shipment contract on retry", async () => {
    await sendSupplierShippingDocumentsEmail({
      fulfillmentId: fulfillment.id,
      dispatchKey: "checkout",
    });
    await sendSupplierShippingDocumentsEmail({
      fulfillmentId: fulfillment.id,
      dispatchKey: "checkout",
    });

    expect(mocks.createShipmentForOrder).toHaveBeenCalledTimes(2);
    expect(
      mocks.trackedDispatch.mock.calls.map(([input]) => input.idempotencyKey),
    ).toEqual([
      "supplier-shipping-documents:fulfillment-1:checkout",
      "supplier-shipping-documents:fulfillment-1:checkout",
    ]);
  });
});
