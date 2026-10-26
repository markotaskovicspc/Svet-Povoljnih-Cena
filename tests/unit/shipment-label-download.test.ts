import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), shipment: vi.fn(), pdf: vi.fn(), html: vi.fn(), lines: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { shipment: { findUnique: mocks.shipment }, pickupBatchLine: { findMany: mocks.lines } } }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.admin }));
vi.mock("@/lib/mygls", () => ({ MYGLS_PROVIDER: "MYGLS", downloadMyGlsLabelPdf: vi.fn() }));
vi.mock("@/lib/pdf/print-html", () => ({ renderPrintHtmlPdf: mocks.pdf }));
vi.mock("@/lib/x-express/labels", () => ({ renderXExpressLabelsHtml: mocks.html }));
import { GET } from "@/app/api/admin/shipments/[id]/label/route";
const request = () => GET(new Request("https://example.test/api/admin/shipments/s1/label"), { params: Promise.resolve({ id: "s1" }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ id: "operator", role: "OPS", accessPolicy: null });
  mocks.shipment.mockResolvedValue({ id: "s1", purpose: "ORDER_DELIVERY", provider: "X_EXPRESS", status: "CREATED", trackingNo: "AAA0850301437", order: { status: "U_PRIPREMI", paymentMethod: "POUZECE_GOTOVINA", payments: [] } });
  mocks.html.mockReturnValue("<html>label</html>");
  mocks.pdf.mockResolvedValue(Buffer.from("%PDF-1.7\n"));
});
it("returns a standalone PDF file for an individual X Express shipment", async () => {
  const result = await request();
  expect(result.status).toBe(200);
  expect(result.headers.get("content-type")).toBe("application/pdf");
  expect(result.headers.get("content-disposition")).toContain("x-express-adresnica-AAA0850301437.pdf");
  expect(await result.text()).toMatch(/^%PDF-/);
  expect(mocks.admin).toHaveBeenCalledWith(["OPS"], ["/admin/erp/prodajni-nalozi", "/admin/erp/preuzimanja", "/admin/erp/reklamacije-dnevnik"]);
  expect(mocks.shipment).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "s1" } }));
  expect(mocks.pdf).toHaveBeenCalledWith("<html>label</html>");
});
it.each(["RECLAMATION_RETURN", "RECLAMATION_REPLACEMENT"])("does not expose a %s label to a custom sales-order account", async purpose => {
  mocks.admin.mockResolvedValue({ id: "sales", role: "CUSTOM", accessPolicy: { version: 1, modules: ["/admin/erp/prodajni-nalozi"] } });
  const shipment = await mocks.shipment();
  mocks.shipment.mockResolvedValue({ ...shipment, purpose });
  const result = await request();
  expect(result.status).toBe(403);
  expect(await result.json()).toEqual({ ok: false, error: "Nemate pristup adresnici za ovu vrstu pošiljke." });
  expect(mocks.html).not.toHaveBeenCalled();
  expect(mocks.pdf).not.toHaveBeenCalled();
  expect(mocks.lines).not.toHaveBeenCalled();
});
it("reprints an existing label after a legacy cancellation without creating a new shipment", async () => {
  const shipment = await mocks.shipment();
  mocks.shipment.mockResolvedValue({ ...shipment, order: { ...shipment.order, status: "OTKAZANO" } });
  const result = await request();
  expect(result.status).toBe(200);
  expect(result.headers.get("content-type")).toBe("application/pdf");
  expect(mocks.pdf).toHaveBeenCalledOnce();
});

it("retains the accepted label after the recipient refused delivery", async () => {
  const shipment = await mocks.shipment();
  mocks.shipment.mockResolvedValue({ ...shipment, status: "FAILED", providerShipmentId: "accepted-provider-shipment", order: { ...shipment.order, status: "OTKAZANO" } });
  const result = await request();
  expect(result.status).toBe(200);
  expect(result.headers.get("content-type")).toBe("application/pdf");
});

it("still rejects a failed preparation without courier acceptance", async () => {
  const shipment = await mocks.shipment();
  mocks.shipment.mockResolvedValue({ ...shipment, status: "FAILED", providerShipmentId: null });
  const result = await request();
  expect(result.status).toBe(409);
  expect((await result.json()).error).toBe("x_express_label_unavailable");
  expect(mocks.pdf).not.toHaveBeenCalled();
});

it("recovers old X Express picking contents by their exact saved assignment group", async () => {
  const shipment = await mocks.shipment();
  mocks.shipment.mockResolvedValue({ ...shipment, orderId: "order", pickupBatchLines: [], rawCreateResponse: { assignment: { orderItemIds: ["item"], codAmount: 1, assignmentKey: "order:order:X_EXPRESS:deferred:original" } } });
  const lines = [{ packageNo: 1, packedItems: [{ name: "POMPEA", quantity: 2 }], providerParcelNumber: null }];
  mocks.lines.mockResolvedValue(lines);
  expect((await request()).status).toBe(200);
  expect(mocks.lines).toHaveBeenCalledWith(expect.objectContaining({ where: { orderId: "order", lineGroupKey: "order:order:X_EXPRESS:deferred:original", deferredAt: null, batch: { provider: "X_EXPRESS" } } }));
  expect(mocks.html).toHaveBeenCalledWith(expect.objectContaining({ pickupBatchLines: lines }));
});
