import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fulfillmentFindUnique: vi.fn(),
  fulfillmentUpdateMany: vi.fn(),
  shipmentFindUnique: vi.fn(),
  createShipmentForOrder: vi.fn(),
  trackedDispatch: vi.fn(),
  downloadMyGlsLabelPdf: vi.fn(),
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
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: vi.fn() }));
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
  renderXExpressLabelsHtml: vi.fn(),
}));

import { sendSupplierShippingDocumentsEmail } from "@/lib/rabalux/fulfillment";

const fulfillment = {
  id: "fulfillment-1",
  status: "PENDING",
  sentAt: null,
  supplier: {
    name: "Rabalux",
    email: "warehouse@rabalux.example",
    integrationKey: "RABALUX",
    enabled: true,
  },
  order: {
    id: "order-1",
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

describe("Rabalux COD courier fulfillment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fulfillmentFindUnique.mockResolvedValue(fulfillment);
    mocks.fulfillmentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.createShipmentForOrder.mockResolvedValue({
      id: "shipment-1",
      provider: "MYGLS",
      providerShipmentId: "provider-shipment-1",
      trackingNo: "MYGLS-123",
    });
    mocks.shipmentFindUnique.mockResolvedValue({
      id: "shipment-1",
      provider: "MYGLS",
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
      codAmount: 12_999,
      announceXExpress: false,
    });
    expect(mocks.trackedDispatch).toHaveBeenCalledTimes(1);
    const dispatch = mocks.trackedDispatch.mock.calls[0]![0];
    expect(dispatch.idempotencyKey).toBe(
      "supplier-shipping-documents:fulfillment-1:checkout",
    );
    expect(dispatch.attachments.map((item: { filename: string }) => item.filename))
      .toEqual([
        "adresnica-SPC-2026-000123.pdf",
        "pak-lista-SPC-2026-000123.pdf",
      ]);
    expect(JSON.stringify(dispatch)).not.toMatch(
      /predračun|predracun|garantni-list|12[.,]?999/i,
    );
    expect(mocks.fulfillmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PICKUP_READY", lastError: null }),
      }),
    );
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
