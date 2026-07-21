import { afterEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  fiscalProductSync: {
    findMany: vi.fn(async () => [
      { sku: "1001", providerSku: 1001 },
    ]),
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import { fiscalizeWithBadi } from "@/lib/fiscal/badi";
import { __resetFiscalConfig } from "@/lib/fiscal/config";

const names = [
  "BADI_API_KEY",
  "BADI_API_SECRET",
  "BADI_BASE_URL",
  "BADI_CLIENT_ID",
  "BADI_STORE_ID",
  "BADI_CASHIER_ID",
  "BADI_FISCAL_MODE",
  "BADI_VPFR_PFX",
  "BADI_VPFR_PASSWORD",
  "BADI_VPFR_PAC",
] as const;
const originals = Object.fromEntries(names.map((name) => [name, process.env[name]]));
const originalFetch = global.fetch;

function fakePfxBase64() {
  const bytes = Buffer.alloc(512, 1);
  bytes[0] = 0x30;
  return bytes.toString("base64");
}

afterEach(() => {
  for (const name of names) {
    const value = originals[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  global.fetch = originalFetch;
  __resetFiscalConfig();
});

describe("badi VPFR transport", () => {
  it("sends base64 certificate headers with the required store and cashier identity", async () => {
    const pfx = fakePfxBase64();
    process.env.BADI_API_KEY = "api-key";
    process.env.BADI_API_SECRET = "api-secret";
    process.env.BADI_BASE_URL = "https://badi.example.test/v2";
    process.env.BADI_CLIENT_ID = "legacy-client-id";
    process.env.BADI_STORE_ID = "store-id";
    process.env.BADI_CASHIER_ID = "cashier-id";
    process.env.BADI_FISCAL_MODE = "vpfr";
    process.env.BADI_VPFR_PFX = pfx;
    process.env.BADI_VPFR_PASSWORD = "certificate-password";
    process.env.BADI_VPFR_PAC = "ABC123";
    __resetFiscalConfig();

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          invoiceNumber: "STORE-CASHIER-1",
          verificationUrl: "https://suf.example.test/verify",
          sdcDateTime: "2026-07-21T15:00:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    const result = await fiscalizeWithBadi({
      invoiceRef: "ORDER-1",
      total: 100,
      paymentMethod: "CASH",
      lines: [{ sku: "1001", name: "Test", qty: 1, unitPrice: 100 }],
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://badi.example.test/v2/fiscalization/receipts");
    expect(init?.headers).toMatchObject({
      pfx,
      password: "certificate-password",
      pac: "ABC123",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      storeId: "store-id",
      cashierId: "cashier-id",
      invoiceType: "normal",
      transactionType: "sale",
    });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("clientId");
  });
});
