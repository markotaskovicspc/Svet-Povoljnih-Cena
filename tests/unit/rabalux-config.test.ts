import type { Supplier } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  rabaluxStockAuthenticationStatus,
  rabaluxStockCredentials,
} from "@/lib/rabalux/config";

const supplier = {
  stockAuthUser: "env:RABALUX_STOCK_USER",
  stockAuthPass: "env:RABALUX_STOCK_PASS",
} as Supplier;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Rabalux stock API credentials", () => {
  it("prefers the explicitly named stock API key", () => {
    vi.stubEnv("RABALUX_STOCK_USER", "partner-user");
    vi.stubEnv("RABALUX_STOCK_API_KEY", "supplier-api-key");
    vi.stubEnv("RABALUX_STOCK_PASS", "legacy-secret");

    expect(rabaluxStockCredentials(supplier)).toEqual({
      user: "partner-user",
      pass: "supplier-api-key",
    });
    expect(rabaluxStockAuthenticationStatus(supplier)).toEqual({
      configured: true,
      dedicatedApiKey: true,
    });
  });

  it("keeps the legacy stock secret as a migration fallback", () => {
    vi.stubEnv("RABALUX_STOCK_USER", "partner-user");
    vi.stubEnv("RABALUX_STOCK_API_KEY", "");
    vi.stubEnv("RABALUX_STOCK_PASS", "legacy-secret");

    expect(rabaluxStockCredentials(supplier)).toEqual({
      user: "partner-user",
      pass: "legacy-secret",
    });
    expect(rabaluxStockAuthenticationStatus(supplier)).toEqual({
      configured: true,
      dedicatedApiKey: false,
    });
  });
});
