import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ document: vi.fn(), update: vi.fn(), transaction: vi.fn(), submit: vi.fn(), inventory: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { sefDocument: { findUniqueOrThrow: mocks.document, update: mocks.update }, $transaction: mocks.transaction } }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: vi.fn() }));
vi.mock("@/lib/sef/config", () => ({ requireSefConfig: () => ({ environment: "production", baseUrl: "https://efaktura.mfin.gov.rs", apiKey: "fixture" }) }));
vi.mock("@/lib/sef/inventory.server", () => ({ ensureSefInventoryPosted: mocks.inventory }));
vi.mock("@/lib/sef/client", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/sef/client")>();
  return { ...original, SefClient: class { submitInvoice = mocks.submit; } };
});
import { sendSefInvoice, sefXmlDigest } from "@/lib/sef/documents.server";
import { SefApiError } from "@/lib/sef/client";
const document = { id: "s1", direction: "OUT", environment: "production", orderId: "o1", requestId: "stable-1", xml: "<fixture/>", status: "DRAFT", sentAt: null };
beforeEach(() => { vi.clearAllMocks(); mocks.document.mockResolvedValue(document); });
describe("SEF financial write boundary", () => {
  it("does not call the provider again after a confirmed submission", async () => {
    mocks.document.mockResolvedValue({ ...document, sentAt: new Date(), remoteId: "111" });
    await sendSefInvoice("s1", sefXmlDigest(document.xml));
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.inventory).toHaveBeenCalledWith("s1");
  });
  it("rejects changed preview contents before claiming or sending", async () => {
    await expect(sendSefInvoice("s1", sefXmlDigest("<different/>"))).rejects.toThrow("promenjen");
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("an atomic failed claim prevents a competing writer from sending", async () => {
    mocks.transaction.mockResolvedValue({ count: 0 });
    await expect(sendSefInvoice("s1", sefXmlDigest(document.xml))).rejects.toThrow("čeka proveru");
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("records UNKNOWN on a timed out write and retains the stable request id", async () => {
    mocks.transaction.mockResolvedValue({ count: 1 }); mocks.submit.mockRejectedValue(new SefApiError("SEF timeout", null));
    await expect(sendSefInvoice("s1", sefXmlDigest(document.xml))).rejects.toThrow("blokira duplikat");
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(document.xml, "stable-1");
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { status: "UNKNOWN", error: "SEF timeout" } });
  });
  it("keeps a definite validation refusal recoverable without pretending it was submitted", async () => {
    mocks.transaction.mockResolvedValue({ count: 1 }); mocks.submit.mockRejectedValue(new SefApiError("SEF HTTP 400", 400));
    await expect(sendSefInvoice("s1", sefXmlDigest(document.xml))).rejects.toThrow("odbio");
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { status: "ERROR", error: "SEF HTTP 400" } });
  });
});
