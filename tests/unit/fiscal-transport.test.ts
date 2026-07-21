import { afterEach, describe, expect, it } from "vitest";

import { __resetFiscalConfig } from "@/lib/fiscal/config";
import { fiscalize } from "@/lib/fiscal/transport";

const originalProvider = process.env.FISCAL_PROVIDER;
const originalApiKey = process.env.BADI_API_KEY;
const originalApiSecret = process.env.BADI_API_SECRET;
const originalClientId = process.env.BADI_CLIENT_ID;

afterEach(() => {
  for (const [name, value] of [
    ["FISCAL_PROVIDER", originalProvider],
    ["BADI_API_KEY", originalApiKey],
    ["BADI_API_SECRET", originalApiSecret],
    ["BADI_CLIENT_ID", originalClientId],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  __resetFiscalConfig();
});

const invoice = {
  invoiceRef: "ORDER-1",
  total: 100,
  paymentMethod: "CASH" as const,
  lines: [{ sku: "SKU-1", name: "Test", qty: 1, unitPrice: 100 }],
};

describe("fiscal transport", () => {
  it("fails closed instead of issuing a dummy receipt for an incomplete selected provider", async () => {
    process.env.FISCAL_PROVIDER = "badi";
    delete process.env.BADI_API_KEY;
    delete process.env.BADI_API_SECRET;
    delete process.env.BADI_CLIENT_ID;
    __resetFiscalConfig();

    const result = await fiscalize(invoice);

    expect(result.ok).toBe(false);
    expect(result.provider).toBe("badi");
    if (!result.ok) expect(result.error).toContain("fiscal:config");
  });

  it("keeps deterministic development receipts only for the explicit none provider", async () => {
    process.env.FISCAL_PROVIDER = "none";
    __resetFiscalConfig();

    const result = await fiscalize(invoice);

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("none");
    if (result.ok) expect(result.receipt.receiptNumber).toMatch(/^DEV-/);
  });
});
