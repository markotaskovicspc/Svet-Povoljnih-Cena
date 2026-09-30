import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";
import { db } from "@/lib/db";
import { createReclamationShipment, cancelReclamationShipment, receiveReclamationReturn } from "@/lib/admin/reclamation-fulfillment.server";
import { createMyGlsShipmentForOrder } from "@/lib/mygls/shipments";
import { syncMyGlsShipmentById } from "@/lib/mygls/sync";
import { canReceiveReclamationShipment, myGlsReturnBooking } from "@/lib/mygls/return-booking";
import { downloadMyGlsLabelPdf } from "@/lib/mygls/labels";
import { readMyGlsPageText } from "@/lib/mygls/label-redaction";
import { applyShipmentEvent, createShipmentForOrder, preflightShipmentForOrder } from "@/lib/courier/registry";

// Run only through the isolated runner: real DB + real provider client + local HTTP mocks.
const provider = process.env.MYGLS_BASE_URL!;
const storage = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const tag = `QA-PRS-${Date.now()}`;
let warehouseId = "", productId = "", actorId = "";
const browser = { email: `${tag.toLowerCase()}@example.invalid`, password: `${tag}!Test`, claims: {} as Record<string, { id: string; orderId: string; number: string; orderItemId: string }> };
async function scenario(value: object, target = provider) {
  const response = await fetch(`${target}/scenario`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  expect(response.ok).toBe(true);
}
async function printRequests() {
  const response = await fetch(`${provider}/requests`);
  const body = await response.json();
  return body.requests.filter((r: { method: string }) => r.method === "PrintLabels");
}
async function fixture(name: string, quantity = 1) {
  const number = `${tag}-${name}`;
  const order = await db.order.create({ data: {
    number, status: "ISPORUCENO", channel: "WEB", subtotal: 1000 * quantity, total: 1000 * quantity,
    shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA", shipFirstName: "QA", shipLastName: "Povrat",
    shipPhone: "+381641112223", shipStreet: "Testna", shipHouseNumber: "10", shipCity: "Beograd", shipPostalCode: "11000", shipCountry: "RS",
    glsDeliveryPointId: "QA-LOCKER", glsDeliveryPointAddress: "Paketomat 99", glsDeliveryPointCity: "Novi Sad", glsDeliveryPointPostalCode: "21000",
    termsAcceptedAt: new Date(), items: { create: { productId, sku: tag, name: "QA P&R artikal", qty: quantity, unitPriceFull: 1000, unitPriceSale: 1000, warehouseId, warehouseReservedQty: quantity } },
  }, include: { items: true } });
  const claim = await db.reclamation.create({ data: {
    number: `R-${number}`, orderId: order.id, orderItemId: order.items[0].id, productId, sku: tag, quantity,
    customerFirst: "QA", customerLast: "Povrat", description: "Izolovana P&R provera", notifyVia: "EMAIL",
    decision: "PRIHVACENA", resolution: "POVRAT_NOVCA", warehouseId, warehouseStatus: "READY",
  } });
  const result = { id: claim.id, orderId: order.id, number: claim.number, orderItemId: order.items[0].id };
  browser.claims[name] = result;
  return result;
}
const create = (id: string) => createReclamationShipment({ reclamationId: id, purpose: "RECLAMATION_RETURN", actorId });
const shipment = (id: string) => db.shipment.findFirstOrThrow({ where: { reclamationId: id, purpose: "RECLAMATION_RETURN" } });

beforeAll(async () => {
  if (process.env.E2E_MYGLS_FLOW !== "1" || !provider.startsWith("http://127.0.0.1:") || !storage.startsWith("http://127.0.0.1:") || !/^mygls_e2e_/.test(new URL(process.env.DATABASE_URL!).searchParams.get("schema") ?? "")) throw new Error("Use the isolated MyGLS runner.");
  actorId = (await db.adminUser.create({ data: { email: browser.email, passwordHash: await bcrypt.hash(browser.password, 10), role: "OPS", enabled: true } })).id;
  warehouseId = (await db.warehouse.create({ data: { code: tag, name: "QA Povratni magacin", address: "Testna ulica 1", city: "Beograd", isDefault: true, active: true } })).id;
  productId = (await db.product.create({ data: { sku: tag, slug: tag.toLowerCase(), name: "QA P&R artikal", description: "QA", fullPrice: 1000, isActive: false, stock: 0, grossWeightKg: 20, unitPackWidthCm: 60, unitPackHeightCm: 80, unitPackDepthCm: 70 } })).id;
});
afterAll(async () => {
  if (process.env.MYGLS_E2E_RUNNER === "browser") {
    for (const name of ["browser-create", "browser-reject", "browser-unknown", "browser-storage", "browser-cancel"]) await fixture(name);
    const legacy = await fixture("browser-legacy");
    await db.shipment.create({ data: { orderId: legacy.orderId, reclamationId: legacy.id, purpose: "RECLAMATION_RETURN", provider: "MYGLS", service: "COURIER_SMALL", trackingNo: "99999991", providerParcelId: "99991", providerParcelIds: [99991], providerParcelNumbers: [99999991], status: "CREATED", rawCreateResponse: {} } });
    const denied = await fixture("browser-unaccepted");
    await db.reclamation.update({ where: { id: denied.id }, data: { decision: "CEKA" } });
    await scenario({});
    await scenario({}, storage);
    mkdirSync("output/playwright", { recursive: true });
    writeFileSync("output/playwright/gls-prs-fixtures.json", JSON.stringify(browser, null, 2));
  }
  // The runner drops the entire guarded schema, including every test artifact.
  await db.$disconnect();
});

describe("P&R acceptance through real database and HTTP boundaries", () => {
  it("requests PRS for every parcel at the home address, saves a printable confirmation and reuses it", async () => {
    const claim = await fixture("multiple", 2);
    const before = (await printRequests()).length;
    const result = await create(claim.id);
    const request = (await printRequests()).at(-1).body;
    expect(request.ParcelList).toHaveLength(2);
    for (const parcel of request.ParcelList) {
      expect(parcel.ServiceList).toEqual([{ Code: "PRS" }]);
      expect(parcel.CODAmount).toBe(0);
      expect(parcel.PickupAddress).toMatchObject({ Street: "Testna", HouseNumber: "10", City: "Beograd", ContactPhone: "+381641112223" });
      expect(parcel.DeliveryAddress.City).toBe("Beograd");
    }
    expect(myGlsReturnBooking(result).state).toBe("ACCEPTED");
    const raw = result.rawCreateResponse as { PrintLabelsInfoList: { ParcelNumberWithCheckdigit: number }[] };
    expect(result.trackingNo).toBe(String(raw.PrintLabelsInfoList[0].ParcelNumberWithCheckdigit));
    const pdf = await downloadMyGlsLabelPdf(result.labelObjectKey!, [], true);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const document = await PDFDocument.load(pdf);
    expect(document.getPages().flatMap(page => readMyGlsPageText(document, page)).map(block => block.text).join(" ")).toContain("Pick & Return");
    await create(claim.id);
    expect((await printRequests()).length - before).toBe(1);
    expect(await db.shipment.count({ where: { reclamationId: claim.id } })).toBe(1);
    expect((await db.reclamation.findUniqueOrThrow({ where: { id: claim.id } })).courierRequestedAt).not.toBeNull();
  });
  it("serializes concurrent clicks in PostgreSQL before booking", async () => {
    const claim = await fixture("concurrent");
    const before = (await printRequests()).length;
    const results = await Promise.allSettled([create(claim.id), create(claim.id), create(claim.id)]);
    expect(results.some(result => result.status === "fulfilled")).toBe(true);
    expect((await printRequests()).length - before).toBe(1);
    expect(myGlsReturnBooking(await shipment(claim.id)).state).toBe("ACCEPTED");
  });
  it("allows retry after definitive rejection, without marking the courier requested prematurely", async () => {
    const claim = await fixture("rejected");
    await scenario({ printFailure: "reject" });
    await expect(create(claim.id)).rejects.toThrow("QA invalid pickup phone");
    expect(myGlsReturnBooking(await shipment(claim.id)).state).toBe("REJECTED");
    expect((await db.reclamation.findUniqueOrThrow({ where: { id: claim.id } })).courierRequestedAt).toBeNull();
    expect(myGlsReturnBooking(await create(claim.id)).state).toBe("ACCEPTED");
  });
  it.each(["http500", "partial"])("blocks a second booking after ambiguous %s", async (printFailure) => {
    const claim = await fixture(printFailure, printFailure === "partial" ? 2 : 1);
    const before = (await printRequests()).length;
    await scenario({ printFailure });
    await expect(create(claim.id)).rejects.toThrow();
    expect(myGlsReturnBooking(await shipment(claim.id)).state).toBe("UNKNOWN");
    await expect(create(claim.id)).rejects.toThrow(/Ishod/);
    await expect(createShipmentForOrder(claim.orderId, { purpose: "RECLAMATION_RETURN", reclamationId: claim.id })).rejects.toThrow(/Ishod/);
    expect((await printRequests()).length - before).toBe(1);
  });
  it("recovers a missing PDF after storage failure without rebooking the pickup", async () => {
    const claim = await fixture("storage");
    const before = (await printRequests()).length;
    await scenario({ failUploads: true }, storage);
    try { await expect(create(claim.id)).rejects.toThrow(/Upload/); }
    finally { await scenario({}, storage); }
    expect(myGlsReturnBooking(await shipment(claim.id)).state).toBe("ACCEPTED");
    expect((await shipment(claim.id)).labelObjectKey).toBeNull();
    expect((await createShipmentForOrder(claim.orderId, { purpose: "RECLAMATION_RETURN", reclamationId: claim.id })).labelObjectKey).toBeTruthy();
    expect((await printRequests()).length - before).toBe(1);
  });
  it("cancels only an uncollected booking and recreates it once", async () => {
    const claim = await fixture("cancelled");
    const first = await create(claim.id);
    await scenario({ statusCode: "01" });
    await expect(cancelReclamationShipment(first.id, actorId)).rejects.toThrow(/promenu statusa/);
    expect(myGlsReturnBooking(await shipment(claim.id)).state).toBe("ACCEPTED");
    await scenario({ statusCode: "51" });
    await cancelReclamationShipment(first.id, actorId);
    expect(myGlsReturnBooking(await shipment(claim.id)).state).toBe("CANCELLED");
    await expect(syncMyGlsShipmentById(first.id, { notify: false })).rejects.toThrow(/nalog je otkazan/);
    expect(myGlsReturnBooking(await shipment(claim.id)).state).toBe("CANCELLED");
    const second = await create(claim.id);
    expect(second.id).toBe(first.id);
    expect(second.trackingNo).not.toBe(first.trackingNo);
    expect(myGlsReturnBooking(second).state).toBe("ACCEPTED");
  });
  it("rejects invalid phone/address, unaccepted decisions and missing warehouses before GLS I/O", async () => {
    const claim = await fixture("invalid");
    const before = (await printRequests()).length;
    await db.order.update({ where: { id: claim.orderId }, data: { shipPhone: "bad" } });
    await expect(create(claim.id)).rejects.toThrow(/telefon/);
    await db.order.update({ where: { id: claim.orderId }, data: { shipPhone: "+381641112223", shipHouseNumber: "", shipStreet: "Bez broja" } });
    await expect(create(claim.id)).rejects.toThrow();
    await db.reclamation.update({ where: { id: claim.id }, data: { decision: "CEKA" } });
    await expect(create(claim.id)).rejects.toThrow(/prihvatanja/);
    await db.reclamation.update({ where: { id: claim.id }, data: { decision: "PRIHVACENA", warehouseId: null } });
    await expect(create(claim.id)).rejects.toThrow(/magacin/);
    expect((await printRequests()).length).toBe(before);
  });
  it("receives delivered returns exactly once and keeps the original order delivered", async () => {
    const claim = await fixture("delivered");
    const result = await create(claim.id);
    const receive = () => receiveReclamationReturn({ reclamationId: claim.id, warehouseId, actorId });
    await expect(receive()).rejects.toThrow(/isporuku u magacin/);
    await applyShipmentEvent("COURIER_SMALL", { trackingNo: result.trackingNo!, status: "PICKED_UP", providerStatusCode: "01" });
    expect((await db.order.findUniqueOrThrow({ where: { id: claim.orderId } })).status).toBe("ISPORUCENO");
    await expect(receive()).rejects.toThrow(/isporuku u magacin/);
    await applyShipmentEvent("COURIER_SMALL", { trackingNo: result.trackingNo!, status: "DELIVERED", providerStatusCode: "05" });
    const [a, b] = await Promise.all([receive(), receive()]);
    expect(a.movement.id).toBe(b.movement.id);
    expect(await db.stockMovement.count({ where: { idempotencyKey: `reclamation-return:${claim.id}` } })).toBe(1);
    expect(await db.fiscalDocument.count({ where: { orderId: claim.orderId } })).toBe(0);
  });
  it("does not receive a P&R parcel returned to the customer, and blocks a legacy ordinary label", async () => {
    const claim = await fixture("returned");
    const result = await create(claim.id);
    await applyShipmentEvent("COURIER_SMALL", { trackingNo: result.trackingNo!, status: "RETURNED", providerStatusCode: "17" });
    await expect(receiveReclamationReturn({ reclamationId: claim.id, warehouseId, actorId })).rejects.toThrow(/isporuku u magacin/);
    const legacy = await fixture("legacy");
    await db.shipment.create({ data: { orderId: legacy.orderId, reclamationId: legacy.id, purpose: "RECLAMATION_RETURN", provider: "MYGLS", service: "COURIER_SMALL", trackingNo: "9999999", providerParcelId: "9999", status: "CREATED", rawCreateResponse: {} } });
    await expect(create(legacy.id)).rejects.toThrow(/Obična adresnica/);
    const options = { purpose: "RECLAMATION_RETURN" as const, reclamationId: legacy.id };
    await expect(createShipmentForOrder(legacy.orderId, options)).rejects.toThrow(/Obična adresnica/);
    await expect(preflightShipmentForOrder(legacy.orderId, options)).rejects.toThrow(/Obična adresnica/);
    expect((await db.reclamation.findUniqueOrThrow({ where: { id: legacy.id } })).courierRequestedAt).toBeNull();
  });
  it("requires delivery of every return parcel before receiving the full reclamation quantity", async () => {
    const claim = await fixture("partial-delivery", 2);
    const result = await create(claim.id);
    await scenario({ statusCodes: ["01", "05"] });
    await syncMyGlsShipmentById(result.id, { notify: false });
    expect(canReceiveReclamationShipment(await shipment(claim.id))).toBe(false);
    await expect(receiveReclamationReturn({ reclamationId: claim.id, warehouseId, actorId })).rejects.toThrow(/isporuku u magacin/);
    await scenario({ statusCodes: ["05", "05"] });
    await syncMyGlsShipmentById(result.id, { notify: false });
    expect(canReceiveReclamationShipment(await shipment(claim.id))).toBe(true);
    await receiveReclamationReturn({ reclamationId: claim.id, warehouseId, actorId });
    expect((await db.stockMovement.findUniqueOrThrow({ where: { idempotencyKey: `reclamation-return:${claim.id}` } })).qty).toBe(2);
    await scenario({});
  });
  it("keeps replacement delivery forward, zero-COD and without PRS", async () => {
    const claim = await fixture("replacement");
    await db.reclamation.update({ where: { id: claim.id }, data: { resolution: "ZAMENA_ARTIKLA", replacementQty: 1 } });
    await createMyGlsShipmentForOrder(claim.orderId, { purpose: "RECLAMATION_REPLACEMENT", reclamationId: claim.id, packages: [{ packageNo: 1, orderItemId: claim.orderItemId, content: "QA P&R artikal", weightKg: 20, widthCm: 60, heightCm: 80, depthCm: 70 }] });
    const parcel = (await printRequests()).at(-1).body.ParcelList[0];
    expect(parcel.ServiceList.some((service: { Code: string }) => service.Code === "PRS")).toBe(false);
    expect(parcel.CODAmount).toBe(0);
    expect(parcel.PickupAddress.Name).toBe("Svet povoljnih cena QA");
  });
});
