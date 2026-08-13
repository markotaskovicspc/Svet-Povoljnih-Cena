import { describe, expect, it } from "vitest";
import { isUnsafeFiscalRedispatch } from "@/lib/fiscal/retry-safety";
import {
  ipsAmountsMatch,
  isLateIpsPaymentState,
  parseIpsAmountToMinorUnits,
} from "@/lib/payments/ips";
import { capDiscountComponents } from "@/lib/pricing/engine";

describe("financial safety boundaries", () => {
  it("reconciles capped discount components exactly to the allowed total", () => {
    const result = capDiscountComponents(
      { voucher: 30, first: 5, card: 5 },
      30,
    );

    expect(result).toEqual({ voucher: 22, first: 4, card: 4 });
    expect(result.voucher + result.first + result.card).toBe(30);
  });

  it("does not allocate more than a fractional requested discount", () => {
    const result = capDiscountComponents(
      { voucher: 0.6, first: 0.6, card: 0 },
      1,
    );

    expect(result.voucher).toBeLessThanOrEqual(0.6);
    expect(result.first).toBeLessThanOrEqual(0.6);
    expect(result.voucher + result.first + result.card).toBeCloseTo(1, 10);
  });

  it("compares IPS amounts numerically to two decimal places", () => {
    expect(parseIpsAmountToMinorUnits("0100.0")).toBe(10_000);
    expect(ipsAmountsMatch("100", "100.00")).toBe(true);
    expect(ipsAmountsMatch("0100.0", "100.00")).toBe(true);
    expect(ipsAmountsMatch("100.001", "100.00")).toBe(false);
    expect(ipsAmountsMatch("1e2", "100.00")).toBe(false);
  });

  it("marks a payment as late after cancellation or stock restoration", () => {
    expect(isLateIpsPaymentState("KREIRANO", null)).toBe(false);
    expect(isLateIpsPaymentState("OTKAZANO", null)).toBe(true);
    expect(
      isLateIpsPaymentState("KREIRANO", new Date("2026-08-07T00:00:00.000Z")),
    ).toBe(true);
  });

  it("blocks fiscal redispatch after an ambiguous provider handoff", () => {
    const dispatchedAt = new Date("2026-08-07T00:00:00.000Z");
    expect(isUnsafeFiscalRedispatch({ dispatchedAt: null, error: null })).toBe(false);
    expect(
      isUnsafeFiscalRedispatch({ dispatchedAt, error: "fiscal:network timeout" }),
    ).toBe(true);
    expect(
      isUnsafeFiscalRedispatch({ dispatchedAt, error: "fiscal:500:ERR unavailable" }),
    ).toBe(true);
    expect(isUnsafeFiscalRedispatch({ dispatchedAt, error: null })).toBe(true);
    expect(
      isUnsafeFiscalRedispatch({ dispatchedAt, error: "fiscal:400:BAD request" }),
    ).toBe(false);
    expect(
      isUnsafeFiscalRedispatch({
        dispatchedAt,
        error: "fiscal:config BADI nije konfigurisan",
      }),
    ).toBe(false);
  });
});
