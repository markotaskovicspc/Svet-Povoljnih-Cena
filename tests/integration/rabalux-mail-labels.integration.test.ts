import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SendEmailCommandInput } from "@aws-sdk/client-sesv2";
import { PDFDocument } from "pdf-lib";
import { db } from "@/lib/db";
import { __resetEmailConfig } from "@/lib/email/config";
import { __setSesClientForTests } from "@/lib/email/ses";
import { enqueueBackgroundJob, processBackgroundJob } from "@/lib/background-jobs";
import { createShipmentForOrder } from "@/lib/courier/registry";
import { readShipmentAssignment } from "@/lib/courier/shipment-assignment";
import { downloadMyGlsLabelPdf } from "@/lib/mygls";
import { loadEligibleOrders, pickupAssignmentCodAmount } from "@/lib/admin/pickup-batch.server";

// Uses real persistence, email composition, label rendering, and courier HTTP
// clients. Only the SES SDK boundary and localhost courier/storage services
// are simulated; no live recipient or courier can receive a request.
const prefix = `RAB-MAIL-LABEL-${Date.now()}`;
const emails: SendEmailCommandInput[] = [];
let rejectNextEmail = false;
let orderId = "";
let fulfillmentId = "";
let dcItemId = "";
let supplierItemId = "";
let initialJobId = "";
let providerBaseUrl = "";

beforeAll(async () => {
  providerBaseUrl = process.env.MYGLS_BASE_URL ?? "";
  for (const endpoint of [providerBaseUrl, process.env.X_EXPRESS_BASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL]) {
    expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  }
  const originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "127.0.0.1") throw new Error("Isolated test forbids external HTTP requests.");
    return originalFetch(input, init);
  });
  vi.stubEnv("EMAIL_PROVIDER", "ses");
  vi.stubEnv("EMAIL_FROM", "QA <qa@example.invalid>");
  vi.stubEnv("AWS_ACCESS_KEY_ID", "isolated-key");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "isolated-secret");
  __resetEmailConfig();
  __setSesClientForTests({
    async send(command) {
      if (rejectNextEmail) {
        rejectNextEmail = false;
        throw new Error("Simulated email outage");
      }
      emails.push(command.input as SendEmailCommandInput);
      return { MessageId: `isolated-${randomUUID()}` };
    },
  });
  await fetch(`${providerBaseUrl}/requests`, { method: "DELETE" });
  await db.xExpressTown.create({ data: { id: 9902026, name: "Beograd", postalCode: "11000", active: true } });
  const warehouse = await db.warehouse.create({ data: { code: prefix, name: prefix, active: true, isDefault: true } });
  const supplier = await db.supplier.create({ data: { name: "Rabalux QA", integrationKey: "RABALUX", email: "infosrb@rabalux.com", enabled: true } });
  const products = await Promise.all(["RAB", "DC"].map((suffix) => db.product.create({ data: {
    sku: `${prefix}-${suffix}`, slug: `${prefix}-${suffix}`.toLowerCase(), name: suffix === "RAB" ? "Shaun2 QA" : "FLEX SEAT QA",
    description: "Isolated dispatch test", fullPrice: suffix === "RAB" ? 182 : 3999,
    packQty: 1, grossWeightKg: 15, unitPackWidthCm: 20, unitPackDepthCm: 57, unitPackHeightCm: suffix === "RAB" ? 88 : 77,
  } })));
  const order = await db.order.create({ data: {
    number: prefix, status: "KREIRANO", channel: "WEB", subtotal: 4181, total: 3554,
    shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA", termsAcceptedAt: new Date(),
    shipFirstName: "QA", shipLastName: "Kupac", shipStreet: "Testna 1", shipCity: "Beograd", shipPostalCode: "11000",
    shipPhone: "+381601234567", shipXExpressTownId: 9902026, guestEmail: "qa@example.invalid",
    items: { create: [
      { productId: products[0].id, sku: products[0].sku, name: products[0].name, qty: 1, unitPriceFull: 182, unitPriceSale: 182,
        supplierReservedQty: 1, supplierIntegrationKey: "RABALUX", supplierExternalSku: "71232" },
      { productId: products[1].id, sku: products[1].sku, name: products[1].name, qty: 1, unitPriceFull: 3999, unitPriceSale: 3999,
        warehouseId: warehouse.id, warehouseReservedQty: 1 },
    ] },
  }, include: { items: true } });
  orderId = order.id;
  dcItemId = order.items.find((item) => item.warehouseReservedQty === 1)!.id;
  supplierItemId = order.items.find((item) => item.supplierReservedQty === 1)!.id;
  fulfillmentId = (await db.supplierFulfillment.create({ data: {
    orderId, supplierId: supplier.id, status: "PENDING",
    items: { create: { orderItemId: supplierItemId, productId: products[0].id, externalSku: "71232", qty: 1 } },
  } })).id;
});

afterAll(() => {
  __setSesClientForTests(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  __resetEmailConfig();
  // The guarded acceptance runner drops the entire temporary schema.
});

describe.sequential("Mixed Rabalux order: SES emails and both courier labels", () => {
  it("loads the DC item and creates a valid MyGLS PDF with the entire COD while Rabalux is pending", async () => {
    const actor = await db.adminUser.create({ data: { email: `${prefix}@example.invalid`, passwordHash: "unused", role: "OPS" } });
    const batch = await db.pickupBatch.create({ data: { number: prefix, provider: "MYGLS", courier: "COURIER_SMALL" } });
    expect(await loadEligibleOrders(batch.id, actor.id)).toMatchObject({ orderCount: 1 });
    const lines = await db.pickupBatchLine.findMany({ where: { batchId: batch.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0].orderItemId).toBe(dcItemId);
    const codAmount = await pickupAssignmentCodAmount(orderId, "MYGLS", [dcItemId]);
    expect(codAmount).toBe(3554);
    const shipment = await createShipmentForOrder(orderId, { orderItemIds: [dcItemId], codAmount });
    expect(shipment.provider).toBe("MYGLS");
    expect(readShipmentAssignment(shipment.rawCreateResponse)).toMatchObject({ orderItemIds: [dcItemId], codAmount: 3554 });
    expect(shipment.labelObjectKey).toBeTruthy();
    const pdf = await PDFDocument.load(await downloadMyGlsLabelPdf(shipment.labelObjectKey!));
    expect(pdf.getPageCount()).toBe(1);
    const log = await courierRequests();
    const gls = log.filter((entry) => entry.method === "PrintLabels");
    expect(gls).toHaveLength(1);
    expect(gls[0].body).toMatchObject({ ParcelList: [expect.objectContaining({ CODAmount: 3554, Count: 1 })] });
    expect(log.filter((entry) => entry.method === "XExpressCreateOrder")).toHaveLength(0);
  });

  it("records an email failure, then retries with two valid PDFs and schedules the supplier courier for tomorrow", async () => {
    const input = { kind: "SUPPLIER_ORDER_EMAIL", payload: { fulfillmentId, dispatchKey: "isolated" }, idempotencyKey: `${prefix}:initial` } as const;
    initialJobId = (await enqueueBackgroundJob(input)).id;
    rejectNextEmail = true;
    expect(await processBackgroundJob(initialJobId)).toMatchObject({ claimed: true, ok: false });
    expect(await db.emailMessage.findFirstOrThrow({ where: { kind: "supplier_order" } })).toMatchObject({ status: "FAILED", provider: "ses" });
    expect(emails).toHaveLength(0);
    await db.backgroundJob.update({ where: { id: initialJobId }, data: { availableAt: new Date(0) } });
    expect(await processBackgroundJob(initialJobId)).toMatchObject({ claimed: true, ok: true });
    const sent = await db.emailMessage.findMany({ where: { kind: "supplier_order" } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ status: "SENT", provider: "ses", error: null, recipient: "infosrb@rabalux.com" });
    expect(emails).toHaveLength(1);
    expect(emails[0].Destination?.ToAddresses).toEqual(["infosrb@rabalux.com"]);
    const body = emails[0].Content!.Simple!;
    expect(body.Subject?.Data).toContain("priprema artikala");
    expect(body.Body?.Text?.Data).toContain("71232");
    expect(body.Body?.Text?.Data).not.toContain("FLEX SEAT");
    expect(body.Attachments?.map((attachment) => attachment.FileName)).toEqual([
      `predracun-rabalux-${prefix}.pdf`, `obrazac-za-odustajanje-${prefix}.pdf`,
    ]);
    for (const attachment of body.Attachments!) {
      expect(attachment.ContentTransferEncoding).toBe("BASE64");
      expect((await PDFDocument.load(attachment.RawContent!)).getPageCount()).toBeGreaterThan(0);
    }
    const documentJob = await db.backgroundJob.findFirstOrThrow({ where: { kind: "SUPPLIER_SHIPPING_DOCUMENTS_EMAIL" } });
    expect(documentJob.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(await processBackgroundJob(documentJob.id)).toMatchObject({ claimed: false });
    expect(await db.shipment.count({ where: { orderId } })).toBe(1);
  });

  it("creates the separate X Express waybill next day, emails it with the packing PDF, and prevents duplicates", async () => {
    await db.order.update({ where: { id: orderId }, data: { createdAt: new Date(Date.now() - 2 * 86400000) } });
    const job = await db.backgroundJob.findFirstOrThrow({ where: { kind: "SUPPLIER_SHIPPING_DOCUMENTS_EMAIL" } });
    await db.backgroundJob.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
    expect(await processBackgroundJob(job.id)).toMatchObject({ claimed: true, ok: true });
    const shipments = await db.shipment.findMany({ where: { orderId } });
    expect(shipments).toHaveLength(2);
    const supplierShipment = shipments.find((shipment) => shipment.provider === "X_EXPRESS")!;
    expect(supplierShipment.providerShipmentId).toBeTruthy();
    expect(readShipmentAssignment(supplierShipment.rawCreateResponse)).toMatchObject({ orderItemIds: [supplierItemId], supplierFulfillmentId: fulfillmentId, codAmount: 0 });
    expect(shipments.reduce((total, shipment) => total + (readShipmentAssignment(shipment.rawCreateResponse)?.codAmount ?? 0), 0)).toBe(3554);
    const email = await db.emailMessage.findFirstOrThrow({ where: { kind: "supplier_shipping_documents" } });
    expect(email).toMatchObject({ status: "SENT", provider: "ses", recipient: "infosrb@rabalux.com", error: null });
    expect(emails).toHaveLength(2);
    const body = emails[1].Content!.Simple!;
    expect(body.Subject?.Data).toContain("Adresnica i kurirski nalog");
    expect(body.Attachments?.map((attachment) => attachment.FileName)).toEqual([
      `adresnica-${prefix}.html`, `pak-lista-${prefix}.pdf`,
    ]);
    const label = Buffer.from(body.Attachments![0].RawContent!).toString("utf8");
    expect(label).toContain("<!doctype html>");
    expect(label).toContain("Rabalux QA magacin");
    expect(label).toContain("Industrijska");
    expect(label).toContain("Shaun2 QA");
    expect(label).not.toContain("FLEX SEAT");
    expect((await PDFDocument.load(body.Attachments![1].RawContent!)).getPageCount()).toBeGreaterThan(0);
    const log = await courierRequests();
    const supplierCalls = log.filter((entry) => entry.method === "XExpressCreateOrder");
    expect(supplierCalls).toHaveLength(1);
    expect(supplierCalls[0].body.Options ?? []).toEqual([]);
    expect(supplierCalls[0].body.Packages).toHaveLength(1);
    expect(await db.supplierFulfillment.findUniqueOrThrow({ where: { id: fulfillmentId } })).toMatchObject({ status: "PICKUP_READY", lastError: null });
    expect(await processBackgroundJob(job.id)).toMatchObject({ claimed: false });
    expect(await processBackgroundJob(initialJobId)).toMatchObject({ claimed: false });
    expect(await db.shipment.count({ where: { orderId } })).toBe(2);
    expect(emails).toHaveLength(2);
    expect((await courierRequests()).length).toBe(log.length);
  });
});

async function courierRequests(): Promise<Array<{ method: string; body: Record<string, unknown> }>> {
  return (await (await fetch(`${providerBaseUrl}/requests`)).json()).requests;
}
