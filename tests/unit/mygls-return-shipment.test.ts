import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ print: vi.fn(), upload: vi.fn(), findOrder: vi.fn(), create: vi.fn(), update: vi.fn(), claim: vi.fn(), findShipment: vi.fn(), findReclamation: vi.fn(), statuses: vi.fn(), remove: vi.fn(), modify: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { order: { findUnique: mocks.findOrder }, reclamation: { findUnique: mocks.findReclamation }, shipment: { create: mocks.create, update: mocks.update, updateMany: mocks.claim, findUnique: mocks.findShipment, findUniqueOrThrow: mocks.findShipment } } }));
vi.mock("@/lib/mygls/labels", () => ({ uploadMyGlsLabelPdf: mocks.upload }));
vi.mock("@/lib/mygls/client", async original => ({ ...await original<typeof import("@/lib/mygls/client")>(), MyGlsClient: class { printLabels = mocks.print; getParcelStatuses = mocks.statuses; deleteLabels = mocks.remove; modifyCOD = mocks.modify; } }));
import { createMyGlsShipmentForOrder, deleteMyGlsLabelsForShipment, modifyMyGlsCODForShipment } from "@/lib/mygls/shipments";
import { MyGlsProviderError } from "@/lib/mygls/config";
let stored: Record<string, unknown> | null;
const options = { purpose: "RECLAMATION_RETURN" as const, reclamationId: "claim-1", packages: [{ packageNo: 1, orderItemId: "item-1", content: "Fotelja", weightKg: 20, widthCm: 60, heightCm: 80, depthCm: 70 }] };
const order = { id: "order-1", number: "SPC-2026-000001", shippingMethod: "KURIR", total: 10000, paymentMethod: "POUZECE_GOTOVINA", shipFirstName: "Test", shipLastName: "Kupac", shipStreet: "Prva 10", shipCity: "Niš", shipPostalCode: "18000", shipCountry: "RS", shipPhone: "0641234567", items: [{ id: "item-1", name: "Fotelja", qty: 1, withAssembly: false }], payments: [] };
beforeEach(() => {
  vi.resetAllMocks(); stored = null;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-02T22:30:00Z")); // Saturday in Serbia.
  for (const [key, value] of Object.entries({ MYGLS_ENABLED: "true", MYGLS_ENV: "test", MYGLS_USERNAME: "test", MYGLS_PASSWORD: "test", MYGLS_CLIENT_NUMBER: "123", MYGLS_SENDER_IDENTITY_CARD_NUMBER: "123456789", MYGLS_SENDER_IDENTITY_TYPE: "PIB", MYGLS_PICKUP_NAME: "DC", MYGLS_PICKUP_STREET: "Evropska", MYGLS_PICKUP_HOUSE_NUMBER: "1", MYGLS_PICKUP_CITY: "Stara Pazova", MYGLS_PICKUP_POSTAL_CODE: "22300", MYGLS_PICKUP_CONTACT_EMAIL: "dc@example.invalid", MYGLS_PICKUP_CONTACT_NAME: "DC", MYGLS_PICKUP_CONTACT_PHONE: "0641234567", FISCAL_TIN: "" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network is forbidden in this test"); }));
  mocks.findOrder.mockImplementation(async () => ({ ...order, shipments: stored ? [JSON.parse(JSON.stringify(stored))] : [] }));
  mocks.findReclamation.mockResolvedValue({ id: "claim-1", orderId: "order-1", orderItemId: "item-1", quantity: 1, warehouseId: "w1" });
  mocks.create.mockImplementation(async ({ data }) => {
    if (stored) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
    stored = { ...data }; return JSON.parse(JSON.stringify(stored));
  });
  mocks.update.mockImplementation(async ({ data }) => { stored = { ...stored, ...data }; return JSON.parse(JSON.stringify(stored)); });
  mocks.claim.mockImplementation(async ({ data }) => { stored = { ...stored, ...data }; return { count: 1 }; });
  mocks.findShipment.mockImplementation(async () => ({ ...stored, order: { number: order.number } }));
  mocks.print.mockImplementation(async ({ parcelList }) => ({ Labels: [...Buffer.from("%PDF-confirmation")], PrintLabelsErrorList: [], PrintLabelsInfoList: parcelList.map((p: { ClientReference: string }, i: number) => ({ ClientReference: p.ClientReference, ParcelId: 100 + i, ParcelNumber: 900000 + i })) }));
  mocks.upload.mockResolvedValue({ objectKey: "private/confirmation.pdf", labelUrl: "/api/admin/shipments/s/label", mimeType: "application/pdf" });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("GLS P&R lifecycle", () => {
  it("sends PRS once, records next Serbian business day, zero COD and a booking confirmation", async () => {
    const result = await createMyGlsShipmentForOrder("order-1", options);
    const parcels = mocks.print.mock.calls[0][0].parcelList;
    expect(parcels[0].ServiceList).toEqual([{ Code: "PRS" }]);
    expect(parcels[0].ClientReference).toMatch(/-R[0-9a-f]{12}$/);
    expect(result.trackingNo).toBe("900000");
    expect(Number(result.codAmount)).toBe(0);
    expect(result.rawCreateResponse).toMatchObject({ myGlsReturn: { state: "ACCEPTED", pickupDate: "2026-10-05" } });
    await createMyGlsShipmentForOrder("order-1", options);
    expect(mocks.print).toHaveBeenCalledTimes(1);
  });
  it("makes concurrent clicks send only one pickup request", async () => {
    const results = await Promise.allSettled([createMyGlsShipmentForOrder("order-1", options), createMyGlsShipmentForOrder("order-1", options)]);
    expect(results.some(r => r.status === "fulfilled")).toBe(true);
    expect(mocks.print).toHaveBeenCalledTimes(1);
  });
  it("blocks a second request after timeout, retaining a searchable reference", async () => {
    mocks.print.mockRejectedValue(new MyGlsProviderError("timeout"));
    await expect(createMyGlsShipmentForOrder("order-1", options)).rejects.toThrow("timeout");
    expect(stored?.rawCreateResponse).toMatchObject({ myGlsReturn: { state: "UNKNOWN", references: [expect.any(String)] } });
    await expect(createMyGlsShipmentForOrder("order-1", options)).rejects.toThrow(/Ishod/);
    expect(mocks.print).toHaveBeenCalledTimes(1);
  });
  it("recovers the saved confirmation after a storage outage without another courier request", async () => {
    mocks.upload.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(createMyGlsShipmentForOrder("order-1", options)).rejects.toThrow("storage unavailable");
    expect(stored?.trackingNo).toBe("900000");
    expect(stored?.rawCreateResponse).toMatchObject({ myGlsReturn: { state: "ACCEPTED" } });
    await expect(createMyGlsShipmentForOrder("order-1", options)).resolves.toMatchObject({ labelObjectKey: "private/confirmation.pdf" });
    expect(mocks.print).toHaveBeenCalledTimes(1);
  });
  it("never accepts a partial multi-package response", async () => {
    mocks.print.mockResolvedValue({ PrintLabelsInfoList: [], Labels: [] });
    await expect(createMyGlsShipmentForOrder("order-1", { ...options, packages: [...options.packages, { ...options.packages[0], packageNo: 2 }] })).rejects.toThrow(/sve P&R pakete/);
    expect(stored?.rawCreateResponse).toMatchObject({ myGlsReturn: { state: "UNKNOWN" } });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("permits retry only after a definite provider rejection", async () => {
    mocks.print.mockRejectedValueOnce(new MyGlsProviderError("Invalid phone", "1", { PrintLabelsErrorList: [{ ErrorCode: 1 }], PrintLabelsInfoList: [] }, true));
    await expect(createMyGlsShipmentForOrder("order-1", options)).rejects.toThrow("Invalid phone");
    expect(stored?.status).toBe("FAILED");
    await expect(createMyGlsShipmentForOrder("order-1", options)).resolves.toMatchObject({ trackingNo: "900000" });
  });
  it("does not silently reuse an ordinary legacy label as a successful pickup", async () => {
    stored = { id: "old", purpose: "RECLAMATION_RETURN", provider: "MYGLS", status: "CREATED", trackingNo: "old-number", rawCreateResponse: {} };
    await expect(createMyGlsShipmentForOrder("order-1", options)).rejects.toThrow(/Obična adresnica/);
    expect(mocks.print).not.toHaveBeenCalled();
  });
});

it("checks live pickup status before allowing P&R cancellation", async () => {
  await createMyGlsShipmentForOrder("order-1", options);
  mocks.statuses.mockResolvedValue({ ParcelNumber: 900000, ParcelStatusList: [{ StatusCode: "01" }] });
  await expect(deleteMyGlsLabelsForShipment(String(stored?.id))).rejects.toThrow(/promenu statusa/);
  expect(mocks.remove).not.toHaveBeenCalled();
  mocks.statuses.mockResolvedValue({ ParcelNumber: 900000, ParcelStatusList: [{ StatusCode: "51" }] });
  mocks.remove.mockResolvedValue({ SuccessfullyDeletedList: [{ ParcelId: 100 }] });
  await deleteMyGlsLabelsForShipment(String(stored?.id));
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([100]);
  expect(stored?.syncError).toBe("MyGLS etiketa obrisana.");
});
it("blocks a past pickup date before reserving or contacting the courier", async () => {
  await expect(createMyGlsShipmentForOrder("order-1", { ...options, pickupDate: new Date("2026-10-01T12:00Z") })).rejects.toThrow(/naredni radni dan/);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.print).not.toHaveBeenCalled();
});
it("keeps an HTTP failure ambiguous even when its body resembles a validation rejection", async () => {
  mocks.print.mockRejectedValue(new MyGlsProviderError("HTTP 500", "1", { PrintLabelsErrorList: [{ ErrorCode: 1 }], PrintLabelsInfoList: [] }));
  await expect(createMyGlsShipmentForOrder("order-1", options)).rejects.toThrow("HTTP 500");
  expect(stored?.rawCreateResponse).toMatchObject({ myGlsReturn: { state: "UNKNOWN" } });
});

it("uses the full tracking number consistently for cancellation and package assignments", async () => {
  mocks.print.mockImplementation(async ({ parcelList }) => ({ Labels: [...Buffer.from("%PDF-confirmation")], PrintLabelsInfoList: [{ ClientReference: parcelList[0].ClientReference, ParcelId: 100, ParcelNumber: 1234, ParcelNumberWithCheckdigit: 12345 }] }));
  const result = await createMyGlsShipmentForOrder("order-1", options);
  expect(result.trackingNo).toBe("12345");
  expect(result.providerParcelNumbers).toEqual([12345]);
  expect(result.rawCreateResponse).toMatchObject({ myGlsPackageAssignments: [{ parcelNumber: 12345 }] });
});
it("uses the requested Serbian calendar day even when midnight is the previous UTC date", async () => {
  vi.setSystemTime(new Date("2026-09-29T10:00:00Z"));
  const result = await createMyGlsShipmentForOrder("order-1", { ...options, pickupDate: new Date("2026-09-30T00:00:00+02:00") });
  expect(result.rawCreateResponse).toMatchObject({ myGlsReturn: { pickupDate: "2026-09-30" } });
});
it.each([[], [{ StatusCode: "99" }], [{ StatusCode: "51" }, { StatusCode: "01" }]])("blocks cancellation with incomplete or progressed history %j", async (history) => {
  await createMyGlsShipmentForOrder("order-1", options);
  mocks.statuses.mockResolvedValue({ ParcelNumber: 900000, ParcelStatusList: history });
  await expect(deleteMyGlsLabelsForShipment(String(stored?.id))).rejects.toThrow();
  expect(mocks.remove).not.toHaveBeenCalled();
});

it.each(["RECLAMATION_RETURN", "RECLAMATION_REPLACEMENT"])("blocks COD modification for %s at the shared service boundary", async (purpose) => {
  stored = { id: "claim-shipment", provider: "MYGLS", purpose, status: "CREATED", providerParcelId: "100", trackingNo: "900000" };
  await expect(modifyMyGlsCODForShipment("claim-shipment", 1000)).rejects.toThrow(/bez otkupnine/);
  expect(mocks.modify).not.toHaveBeenCalled();
});
