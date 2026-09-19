import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ upsert: vi.fn(), find: vi.fn(), update: vi.fn(), lock: vi.fn(), write: vi.fn(), audience: vi.fn(), audit: vi.fn(), tx: vi.fn() }));
vi.mock("@/lib/db", () => ({ databaseIdentifier: (name: string) => Prisma.raw(`"${name}"`), db: { newsletterContactImport: { upsert: mocks.upsert }, $transaction: mocks.tx } }));
vi.mock("@/lib/newsletter/contact-import", () => ({ writeNewsletterContactChunk: mocks.write, upsertImportedContactAudience: mocks.audience }));
import { contactImportBatchSchema, importContactBatch, startContactImport } from "@/lib/newsletter/import-session";
const id = "b5b73db2-68c1-4b78-a9a1-9cbf72388421";
const input = { id, listName: "Sajam", fingerprint: "a".repeat(64), fileName: "test.csv", totalContacts: 201, consentEvidence: null };
const row = (n: number) => ({ email: `p${n}@example.com`, firstName: "Ana", lastName: null, language: "sr-Latn", source: "test", consented: false, consentedAt: null, rowNumber: n + 1, customFields: { Grad: "Niš" } });
beforeEach(() => {
  vi.resetAllMocks();
  const session = { ...input, actorId: "admin", nextBatch: 0, importedCount: 0, completedAt: null };
  mocks.upsert.mockResolvedValue(session); mocks.find.mockResolvedValue(session);
  mocks.audience.mockResolvedValue({ id: "audience" });
  mocks.tx.mockImplementation(async (fn) => fn({ $queryRaw: mocks.lock, newsletterContactImport: { findUnique: mocks.find, update: mocks.update }, auditLog: { create: mocks.audit } }));
});
it("resumes the same import and refuses different owners or content", async () => {
  await expect(startContactImport(input, "admin")).resolves.toMatchObject({ importedCount: 0, nextBatch: 0 });
  await expect(startContactImport(input, "other-admin")).rejects.toThrow("drugom");
  await expect(startContactImport({ ...input, fingerprint: "b".repeat(64) }, "admin")).rejects.toThrow("drugom");
});
it("commits contacts and checkpoint in the same locked transaction", async () => {
  await expect(importContactBatch({ id, batch: 0, contacts: Array.from({ length: 200 }, (_, n) => row(n)) }, "admin")).resolves.toMatchObject({ importedCount: 200, nextBatch: 1, complete: false });
  expect(mocks.lock.mock.calls[0][0].sql).toContain("FOR UPDATE");
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { nextBatch: 1, importedCount: 200, completedAt: null } }));
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("a lost response cannot import a committed batch twice", async () => {
  mocks.find.mockResolvedValue({ ...input, actorId: "admin", nextBatch: 1, importedCount: 200, completedAt: null });
  await expect(importContactBatch({ id, batch: 0, contacts: [row(0)] }, "admin")).resolves.toMatchObject({ nextBatch: 1, importedCount: 200 });
  expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
it("completes the final short chunk, refreshes the list count, and audits completion", async () => {
  mocks.find.mockResolvedValue({ ...input, actorId: "admin", nextBatch: 1, importedCount: 200, completedAt: null });
  await expect(importContactBatch({ id, batch: 1, contacts: [row(200)] }, "admin")).resolves.toMatchObject({ complete: true, importedCount: 201, nextBatch: 2 });
  expect(mocks.audience).toHaveBeenCalledTimes(1); expect(mocks.audit).toHaveBeenCalledTimes(1);
});
it("rejects foreign, out-of-order and incomplete batches before any write", async () => {
  await expect(importContactBatch({ id, batch: 0, contacts: [row(0)] }, "other")).rejects.toThrow("pronađen");
  await expect(importContactBatch({ id, batch: 1, contacts: [row(0)] }, "admin")).rejects.toThrow("Redosled");
  await expect(importContactBatch({ id, batch: 0, contacts: [row(0)] }, "admin")).rejects.toThrow("Broj kontakata");
  expect(mocks.write).not.toHaveBeenCalled();
});
it("does not advance the checkpoint if the contact write fails", async () => {
  mocks.write.mockRejectedValue(new Error("database unavailable"));
  await expect(importContactBatch({ id, batch: 0, contacts: Array.from({ length: 200 }, (_, n) => row(n)) }, "admin")).rejects.toThrow("database unavailable");
  expect(mocks.update).not.toHaveBeenCalled();
});
it("rejects oversized batches, duplicates, and malformed email addresses", () => {
  expect(contactImportBatchSchema.safeParse({ id, batch: 0, contacts: [row(1), row(1)] }).success).toBe(false);
  expect(contactImportBatchSchema.safeParse({ id, batch: 0, contacts: [{ ...row(1), email: "invalid" }] }).success).toBe(false);
  expect(contactImportBatchSchema.safeParse({ id, batch: 0, contacts: Array.from({ length: 201 }, (_, n) => row(n)) }).success).toBe(false);
});
