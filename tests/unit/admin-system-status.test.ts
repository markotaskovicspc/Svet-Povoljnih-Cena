import { describe, expect, it } from "vitest";

import {
  externalMonitoringIsConnected,
  getIntegrationReadiness,
} from "@/lib/admin/system-status";

describe("admin system status", () => {
  it("treats placeholders and disabled production gates as missing", () => {
    const readiness = getIntegrationReadiness({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "GET_FROM_RESEND",
      RESEND_WEBHOOK_SECRET: "CHANGE_ME",
      EMAIL_FROM: "prodavnica@svetpovoljnihcena.rs",
      EMAIL_REPLY_TO: "podrska@svetpovoljnihcena.rs",
      MYGLS_ENABLED: "true",
      MYGLS_PRODUCTION_ACCEPTED: "false",
    });
    const resend = readiness.find((item) => item.id === "resend");
    const mygls = readiness.find((item) => item.id === "mygls");

    expect(resend?.ready).toBe(false);
    expect(resend?.missing).toEqual([
      "RESEND_API_KEY",
      "RESEND_WEBHOOK_SECRET",
    ]);
    expect(mygls?.missing).toContain("MYGLS_PRODUCTION_ACCEPTED");
  });

  it("reports a complete Resend setup without exposing secret values", () => {
    const secret = "re_secret_that_must_not_be_rendered";
    const resend = getIntegrationReadiness({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: secret,
      RESEND_WEBHOOK_SECRET: "whsec_real",
      EMAIL_FROM: "prodavnica@svetpovoljnihcena.rs",
      EMAIL_REPLY_TO: "podrska@svetpovoljnihcena.rs",
    }).find((item) => item.id === "resend");

    expect(resend?.ready).toBe(true);
    expect(resend?.missing).toEqual([]);
    expect(JSON.stringify(resend)).not.toContain(secret);
  });

  it("allows a complete X Express test account but gates production", () => {
    const env = {
      X_EXPRESS_ENABLED: "true",
      X_EXPRESS_ENV: "test",
      X_EXPRESS_PRODUCTION_ACCEPTED: "false",
      X_EXPRESS_BASE_URL: "https://portal.pm.xexpress.rs",
      X_EXPRESS_API_USER: "user",
      X_EXPRESS_API_KEY: "secret",
      X_EXPRESS_CONTRACT_CODE: "U000328",
      X_EXPRESS_CHECK_ADDRESS_PATH: "/api/order/check-address",
      X_EXPRESS_CREATE_ORDER_PATH: "/api/order/add",
      X_EXPRESS_WEBHOOK_API_KEY: "webhook-secret",
      X_EXPRESS_CODE_RANGE_START: "850300000",
      X_EXPRESS_CODE_RANGE_END: "850599999",
      X_EXPRESS_PICKUP_NAME: "DC",
      X_EXPRESS_PICKUP_TOWN_ID: "746606",
      X_EXPRESS_PICKUP_STREET_NAME: "Severna transferzala",
      X_EXPRESS_PICKUP_STREET_NUMBER: "bb",
      X_EXPRESS_PICKUP_LATITUDE: "44.77",
      X_EXPRESS_PICKUP_LONGITUDE: "19.68",
      X_EXPRESS_PICKUP_CONTACT_NAME: "DC",
      X_EXPRESS_PICKUP_CONTACT_PHONE: "381641234567",
    };
    const testAccount = getIntegrationReadiness(env).find(
      (item) => item.id === "x-express",
    );
    expect(testAccount?.ready).toBe(true);
    expect(testAccount?.missing).not.toContain("X_EXPRESS_PRODUCTION_ACCEPTED");

    const production = getIntegrationReadiness({
      ...env,
      X_EXPRESS_ENV: "production",
    }).find((item) => item.id === "x-express");
    expect(production?.ready).toBe(false);
    expect(production?.missing).toContain("X_EXPRESS_PRODUCTION_ACCEPTED");
  });

  it("requires the complete certificate trio for badi VPFR readiness", () => {
    const badi = getIntegrationReadiness({
      FISCAL_PROVIDER: "badi",
      BADI_PRODUCTION_ACCEPTED: "true",
      BADI_API_KEY: "api-key",
      BADI_API_SECRET: "api-secret",
      FISCAL_TIN: "123456789",
      FISCAL_LOCATION_ID: "1234567",
      BADI_FISCAL_MODE: "vpfr",
      BADI_STORE_ID: "store-id",
      BADI_CASHIER_ID: "cashier-id",
      BADI_VPFR_PFX: "base64-pfx",
      BADI_VPFR_PASSWORD: "password",
    }).find((item) => item.id === "badi");

    expect(badi?.ready).toBe(false);
    expect(badi?.missing).toEqual(["BADI_VPFR_PAC"]);
  });

  it("recognizes supported external monitoring configurations", () => {
    expect(
      externalMonitoringIsConnected({
        BETTERSTACK_SOURCE_TOKEN: "GET_FROM_BETTER_STACK",
      }),
    ).toBe(false);
    expect(
      externalMonitoringIsConnected({
        BETTERSTACK_SOURCE_TOKEN: "real-source-token",
      }),
    ).toBe(true);
    expect(externalMonitoringIsConnected({ SENTRY_DSN: "https://dsn" })).toBe(
      true,
    );
  });
});
