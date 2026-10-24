import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
vi.mock("@/lib/db", () => ({ db: {} }));
import { paymentInputSchema, summarizePurchasePayments } from "@/lib/admin/purchase-payments.server";

function payment(id: string, amount: string, amountRsd: string, voidedAt: Date | null = null) {
  return { id, amount: new Prisma.Decimal(amount), amountRsd: new Prisma.Decimal(amountRsd),
    paidAt: new Date("2026-10-23T00:00:00Z"), currency: "EUR", notes: null, voidedAt };
}
describe("purchase payment sums", () => {
  it("adds exact cents, excludes voided entries and is independent of row order", () => {
    const rows = [payment("a", "0.10", "11.71"), payment("b", "0.20", "23.42"),
      payment("void", "999", "99999", new Date())];
    expect(summarizePurchasePayments(rows)).toMatchObject({ count: 2, totalAmount: "0.30", totalRsd: "35.13" });
    expect(summarizePurchasePayments(rows).version).toBe(summarizePurchasePayments([...rows].reverse()).version);
    expect(summarizePurchasePayments(rows.slice(1)).version).not.toBe(summarizePurchasePayments(rows).version);
  });
  it.each(["-1", "0", "1.001", "1e3", "NaN"])("rejects invalid executed payment %s", (amount) => {
    expect(paymentInputSchema.safeParse({ id: "86b0c7c2-2833-4d45-a4da-a41bb77aff1e",
      purchaseOrderId: "po", paidAt: "2026-10-23", amount, amountRsd: "117" }).success).toBe(false);
  });
});
