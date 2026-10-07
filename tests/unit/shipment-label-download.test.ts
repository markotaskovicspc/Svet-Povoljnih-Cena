import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ shipment: vi.fn(), pdf: vi.fn(), html: vi.fn(), lines: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { shipment: { findUnique: mocks.shipment }, pickupBatchLine: { findMany: mocks.lines } } }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: vi.fn() }));
vi.mock("@/lib/mygls", () => ({ MYGLS_PROVIDER: "MYGLS", downloadMyGlsLabelPdf: vi.fn() }));
vi.mock("@/lib/pdf/print-html", () => ({ renderPrintHtmlPdf: mocks.pdf }));
vi.mock("@/lib/x-express/labels", () => ({ renderXExpressLabelsHtml: mocks.html }));
import { GET } from "@/app/api/admin/shipments/[id]/label/route";
const request = () => GET(new Request("https://example.test/api/admin/shipments/s1/label"), { params: Promise.resolve({ id: "s1" }) });
beforeEach(() => {
  vi.resetAllMocks();
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
  expect(mocks.pdf).toHaveBeenCalledWith("<html>label</html>");
});
it("does not regenerate labels for cancelled outgoing goods", async () => {
  const shipment = await mocks.shipment();
  mocks.shipment.mockResolvedValue({ ...shipment, order: { ...shipment.order, status: "OTKAZANO" } });
  const result = await request();
  expect(result.status).toBe(409);
  expect((await result.json()).error).toBe("order_cancelled");
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
