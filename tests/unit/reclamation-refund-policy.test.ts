import { describe, expect, it } from "vitest";
import { allocateClaimRefund, normalizeRefundBankAccount } from "@/lib/admin/reclamation-refund";
import { validateRefundBuyerId } from "@/lib/fiscal/refund-policy";

describe("claim refund allocation", () => {
  const lines = [{ id: "sale", qty: 4, refundedQty: 0, unitPriceGross: 2999 }];
  it("returns only two tables, excluding the shipping line", () => {
    expect(allocateClaimRefund(lines, 2)).toEqual({ lines: [{ id: "sale", qty: 2 }], amount: 5998 });
  });
  it("does not reuse quantities reserved by another unfinished claim", () => {
    expect(() => allocateClaimRefund(lines, 2, new Map([["sale", 3]]))).toThrow("Nema dovoljno");
    expect(() => allocateClaimRefund([{ ...lines[0]!, refundedQty: 3 }], 2)).toThrow("Nema dovoljno");
  });
  it("restores account zeros and rejects an incorrect check digit", () => {
    const base = "1600000000000001";
    const check = (BigInt(98) - BigInt(base + "00") % BigInt(97)).toString().padStart(2, "0");
    expect(normalizeRefundBankAccount(`160-1-${check}`)).toBe(base + check);
    expect(() => normalizeRefundBankAccount(`160-1-00`)).toThrow("kontrolni");
  });
  it("requires a buyer document for cash, but permits bank and card returns without one", () => {
    expect(validateRefundBuyerId("UPLATA_NA_RACUN")).toBeNull();
    expect(validateRefundBuyerId("KARTICA")).toBeNull();
    expect(validateRefundBuyerId("POUZECE_GOTOVINA")).toContain("dokument kupca");
    expect(validateRefundBuyerId("CASH", "20:TEST")).toBeNull();
  });
});
