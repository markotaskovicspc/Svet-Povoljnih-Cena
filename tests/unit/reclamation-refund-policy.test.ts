import { describe, expect, it } from "vitest";
import { allocateClaimRefund, originalPaymentEvidence } from "@/lib/admin/reclamation-refund";
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
  it("requires a buyer document for cash, but permits bank and card returns without one", () => {
    expect(validateRefundBuyerId("UPLATA_NA_RACUN")).toBeNull();
    expect(validateRefundBuyerId("KARTICA")).toBeNull();
    expect(validateRefundBuyerId("POUZECE_GOTOVINA")).toContain("dokument kupca");
    expect(validateRefundBuyerId("CASH", "20:TEST")).toBeNull();
  });
});

describe("automatic original payment evidence", () => {
  const shipment = { id: "s", purpose: "ORDER_DELIVERY", status: "DELIVERED", deliveredAt: new Date(), provider: "X_EXPRESS", codAmount: null, rawCreateResponse: { assignment: { orderItemIds: ["item"], codAmount: 12995 } } };
  const order = { paymentMethod: "POUZECE_GOTOVINA", total: 12995, payments: [{ id: "p", status: "PENDING", amount: 12995 }], shipments: [shipment] };
  it("accepts delivered, matched COD even while courier remittance is still pending", () => {
    expect(originalPaymentEvidence(order)).toEqual({ source: "COD_DELIVERY", ids: ["s"] });
  });
  it.each([
    { status: "RETURNED" }, { status: "IN_TRANSIT" }, { purpose: "RECLAMATION_RETURN" },
    { purpose: "RECLAMATION_REPLACEMENT" }, { codAmount: 0 }, { codAmount: 5998 },
    { deliveredAt: null }, { provider: null }, { syncError: "MyGLS etiketa obrisana." },
  ])("rejects delivery without matching original buyer collection: %j", override => {
    expect(originalPaymentEvidence({ ...order, shipments: [{ ...shipment, ...override }] })).toBeNull();
  });
  it("requires a full settled payment for prepaid methods", () => {
    expect(originalPaymentEvidence({ ...order, paymentMethod: "KARTICA" })).toBeNull();
    expect(originalPaymentEvidence({ ...order, paymentMethod: "KARTICA", payments: [{ id: "p", status: "PAID", amount: 5998 }] })).toBeNull();
    expect(originalPaymentEvidence({ ...order, paymentMethod: "KARTICA", payments: [{ id: "p", status: "PARTIAL_REFUND", amount: 12995 }] })).toEqual({ source: "PAYMENT", ids: ["p"] });
  });
  it("accepts reconciled courier remittance but never counts a duplicate COD collection twice", () => {
    expect(originalPaymentEvidence({ ...order, shipments: [], courierPaidAt: new Date() })?.source).toBe("COURIER_REMITTANCE");
    expect(originalPaymentEvidence({ ...order, shipments: [shipment, { ...shipment, id: "other" }] })).toBeNull();
  });
});
