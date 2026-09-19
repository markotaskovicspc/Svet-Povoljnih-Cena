import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ query: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/db", () => ({ databaseIdentifier: (name: string) => Prisma.raw(`"${name}"`), db: { $queryRaw: mocks.query, marketingContact: { createMany: mocks.create } } }));
import { syncAllNewsletterContacts } from "@/lib/newsletter/all-contacts";
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockImplementation(async ({ data }) => ({ count: data.length })); });
it("copies only valid distinct missing addresses as pending, without consent or overwrites", async () => {
  mocks.query.mockResolvedValue([{ email: " CUSTOMER@EXAMPLE.COM " }, { email: "customer@example.com" }, { email: "invalid" }]);
  expect(await syncAllNewsletterContacts()).toEqual({ added: 1 });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ data: [{ email: "customer@example.com", status: "PENDING", source: "all-contacts", subscribedAt: null, confirmedAt: null }], skipDuplicates: true });
  const sql = mocks.query.mock.calls[0][0].sql;
  expect(sql).toContain('"EmailSuppression"');
  expect(sql).toContain('n."unsubscribedAt" IS NOT NULL');
  expect(sql).toContain('u."deletedAt" IS NOT NULL');
});
it("batches large lists and fails instead of silently truncating oversized imports", async () => {
  mocks.query.mockResolvedValue(Array.from({ length: 2001 }, (_, i) => ({ email: `p${i}@example.com` })));
  expect(await syncAllNewsletterContacts()).toEqual({ added: 2001 });
  expect(mocks.create.mock.calls.map(([args]) => args.data.length)).toEqual([2000, 1]);
  mocks.create.mockClear();
  mocks.query.mockResolvedValue(Array(250001).fill({ email: "too-many@example.com" }));
  await expect(syncAllNewsletterContacts()).rejects.toThrow("250.000");
  expect(mocks.create).not.toHaveBeenCalled();
});
