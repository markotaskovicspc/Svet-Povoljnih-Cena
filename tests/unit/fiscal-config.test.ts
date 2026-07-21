import { afterEach, describe, expect, it } from "vitest";

import {
  __resetFiscalConfig,
  FiscalConfigError,
  getFiscalConfig,
} from "@/lib/fiscal/config";

const fiscalEnvNames = [
  "BADI_API_KEY",
  "BADI_API_SECRET",
  "BADI_CLIENT_ID",
  "BADI_STORE_ID",
  "BADI_CASHIER_ID",
  "BADI_FISCAL_MODE",
  "BADI_VPFR_PFX",
  "BADI_VPFR_PASSWORD",
  "BADI_VPFR_PAC",
  "FISCAL_CASHIER",
  "FISCAL_PROVIDER",
] as const;

const originalEnv = Object.fromEntries(
  fiscalEnvNames.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of fiscalEnvNames) {
    const original = originalEnv[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
  __resetFiscalConfig();
});

function fakePfxBase64() {
  const bytes = Buffer.alloc(512, 1);
  bytes[0] = 0x30;
  return bytes.toString("base64");
}

describe("fiscal configuration", () => {
  it("rejects an incomplete VPFR security element", () => {
    process.env.BADI_FISCAL_MODE = "vpfr";
    process.env.BADI_VPFR_PFX = fakePfxBase64();
    process.env.BADI_VPFR_PASSWORD = "certificate-password";

    expect(() => getFiscalConfig()).toThrow(FiscalConfigError);
  });

  it("normalizes a complete VPFR configuration and uses safe fallbacks", () => {
    const pfx = fakePfxBase64();
    process.env.BADI_FISCAL_MODE = "vpfr";
    process.env.BADI_CLIENT_ID = "store-uuid";
    process.env.FISCAL_CASHIER = "WEB";
    process.env.BADI_VPFR_PFX = `data:application/x-pkcs12;base64,${pfx}`;
    process.env.BADI_VPFR_PASSWORD = "certificate-password";
    process.env.BADI_VPFR_PAC = "ab12cd";

    const badi = getFiscalConfig().badi;

    expect(badi.fiscalMode).toBe("vpfr");
    expect(badi.storeId).toBe("store-uuid");
    expect(badi.cashierId).toBe("WEB");
    expect(badi.vpfr).toEqual({
      pfx,
      password: "certificate-password",
      pac: "AB12CD",
    });
  });

  it("rejects certificate-shaped text that is not base64 PKCS#12 data", () => {
    process.env.BADI_FISCAL_MODE = "vpfr";
    process.env.BADI_STORE_ID = "store-uuid";
    process.env.BADI_CASHIER_ID = "WEB";
    process.env.BADI_VPFR_PFX = "/tmp/security-element.pfx";
    process.env.BADI_VPFR_PASSWORD = "certificate-password";
    process.env.BADI_VPFR_PAC = "ABC123";

    expect(() => getFiscalConfig()).toThrow(/base64/);
  });
});
