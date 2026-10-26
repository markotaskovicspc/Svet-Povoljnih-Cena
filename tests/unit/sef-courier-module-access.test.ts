import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ admin: vi.fn(), document: vi.fn(), xml: vi.fn(), parse: vi.fn(), preview: vi.fn(), apply: vi.fn(), audit: vi.fn(), finalize: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentAdmin: mock.admin }));
vi.mock("@/lib/db", () => ({ db: { sefDocument: { findUniqueOrThrow: mock.document } } }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(path); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ logOperationalError: vi.fn() }));
vi.mock("@/lib/admin/audit", () => ({ logAudit: mock.audit, finalizeAudit: mock.finalize }));
vi.mock("@/lib/admin", async () => {
  const guard = await import("@/lib/admin/guard");
  return { requireAdminAction: guard.requireAdminAction, withAdminState: guard.withAdminState, logAudit: mock.audit };
});
vi.mock("@/lib/sef/inventory.server", () => ({ ensureSefInventoryPosted: vi.fn() }));
vi.mock("@/lib/sef/documents.server", () => ({ queueSefSync: vi.fn(), prepareSefInvoice: vi.fn(), sendSefInvoice: vi.fn(), refreshSefInvoice: vi.fn(), sefXmlDigest: vi.fn() }));
vi.mock("@/lib/sef/ubl", () => ({ readInvoiceXml: mock.xml }));
vi.mock("@/lib/courier/statement-file", () => ({ parseStatementFile: mock.parse }));
vi.mock("@/lib/courier/finance.server", () => ({ previewStatement: mock.preview, importStatement: mock.apply }));

import { confirmSefCourierAttachment, previewSefCourierAttachment } from "@/app/admin/erp/sef/actions";
import { canAccessAdminModule } from "@/lib/admin/access-policy";

const fingerprint = "a".repeat(64);
const rows = [{ kind: "COST", trackingNo: "server-tracking", bookedOn: "2026-10-26", amount: 100, vatIncluded: false }];
const serverInput = { provider: "X_EXPRESS", documentNo: "SERVER-INVOICE", filename: "server.csv", rows };
const doc = { id: "sef-1", direction: "IN", currency: "RSD", number: "SERVER-INVOICE", net: 100, xml: "server XML", issueDate: new Date("2026-10-26") };

beforeEach(() => {
  vi.clearAllMocks();
  mock.admin.mockResolvedValue({ id: "sef-operator", role: "CUSTOM", accessPolicy: { version: 1, modules: ["/admin/erp/sef"] } });
  mock.document.mockResolvedValue(doc);
  mock.xml.mockReturnValue({ attachments: [{ filename: "server.csv", base64: Buffer.from("server attachment").toString("base64") }] });
  mock.parse.mockResolvedValue(rows);
  mock.preview.mockResolvedValue({ input: serverInput, fingerprint, costNet: 100, rows, existing: null });
  mock.apply.mockResolvedValue({ id: "statement", alreadyImported: false, matched: 1 });
  mock.audit.mockResolvedValue({ id: "attempt" }); mock.finalize.mockResolvedValue(undefined);
});

describe("SEF courier attachment confirmation stays within the selected whole module", () => {
  it("lets an SEF-only operator confirm the actual server attachment without arbitrary courier-import access", async () => {
    const actor = await mock.admin();
    expect(canAccessAdminModule(actor, "/admin/erp/kurirski-obracun", ["OPS"])).toBe(false);
    const result = await confirmSefCourierAttachment("sef-1", 0, "X_EXPRESS", fingerprint);
    expect(result.ok).toBe(true);
    expect(mock.document).toHaveBeenCalledWith({ where: { id: "sef-1" } });
    expect(mock.parse).toHaveBeenCalledWith(Buffer.from("server attachment"), "server.csv", "X_EXPRESS", "2026-10-26");
    expect(mock.preview).toHaveBeenCalledWith(serverInput);
    expect(mock.apply).toHaveBeenCalledWith(serverInput, fingerprint, "sef-operator");
  });

  it("rejects a stale fingerprint before any import", async () => {
    const result = await confirmSefCourierAttachment("sef-1", 0, "X_EXPRESS", "b".repeat(64));
    expect(result.ok).toBe(false); expect(mock.apply).not.toHaveBeenCalled();
  });

  it("re-reads and previews the attachment again after the client preview", async () => {
    const form = new FormData(); form.set("id", "sef-1"); form.set("index", "0"); form.set("provider", "X_EXPRESS");
    expect((await previewSefCourierAttachment(form)).ok).toBe(true);
    mock.preview.mockResolvedValue({ input: { ...serverInput, rows: [{ ...rows[0], trackingNo: "changed-server-tracking" }] }, fingerprint: "b".repeat(64), costNet: 100, rows, existing: null });
    expect((await confirmSefCourierAttachment("sef-1", 0, "X_EXPRESS", fingerprint)).ok).toBe(false);
    expect(mock.document).toHaveBeenCalledTimes(2); expect(mock.parse).toHaveBeenCalledTimes(2);
    expect(mock.apply).not.toHaveBeenCalled();
  });

  it.each([{ direction: "OUT" }, { currency: "EUR" }])("refuses an ineligible SEF document %j", async change => {
    mock.document.mockResolvedValue({ ...doc, ...change });
    expect((await confirmSefCourierAttachment("sef-1", 0, "X_EXPRESS", fingerprint)).ok).toBe(false);
    expect(mock.parse).not.toHaveBeenCalled(); expect(mock.apply).not.toHaveBeenCalled();
  });

  it("rejects a missing/non-spreadsheet attachment", async () => {
    mock.xml.mockReturnValue({ attachments: [{ filename: "server.pdf", base64: "" }] });
    expect((await confirmSefCourierAttachment("sef-1", 0, "X_EXPRESS", fingerprint)).ok).toBe(false);
    expect((await confirmSefCourierAttachment("sef-1", 99, "X_EXPRESS", fingerprint)).ok).toBe(false);
    expect(mock.apply).not.toHaveBeenCalled();
  });

  it.each([{ net: 200, kind: "COST" }, { net: 100, kind: "COD" }])("rejects a mismatched total or non-cost attachment %j", async change => {
    mock.document.mockResolvedValue({ ...doc, net: change.net });
    mock.parse.mockResolvedValue([{ ...rows[0], kind: change.kind }]);
    expect((await confirmSefCourierAttachment("sef-1", 0, "X_EXPRESS", fingerprint)).ok).toBe(false);
    expect(mock.apply).not.toHaveBeenCalled();
  });

  it("rejects a courier-only operator at the real guard before document access", async () => {
    mock.admin.mockResolvedValue({ id: "courier-operator", role: "CUSTOM", accessPolicy: { version: 1, modules: ["/admin/erp/kurirski-obracun"] } });
    await expect(confirmSefCourierAttachment("sef-1", 0, "X_EXPRESS", fingerprint)).rejects.toThrow("/admin/pristup-odbijen");
    expect(mock.document).not.toHaveBeenCalled(); expect(mock.apply).not.toHaveBeenCalled();
  });

  it("keeps the client on the bounded SEF confirmation action", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/admin/erp/sef/forms.tsx"), "utf8");
    expect(source).not.toContain("confirmCourierFile");
    expect(source).toContain("confirmSefCourierAttachment(id, index, preview.input.provider, preview.fingerprint)");
  });
});
