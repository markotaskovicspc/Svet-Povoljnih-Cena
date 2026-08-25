import { describe, expect, it } from "vitest";

import {
  externalMonitoringIsConnected,
  getIntegrationReadiness,
} from "@/lib/admin/system-status";

describe("admin system status", () => {
  it("treats placeholders and disabled production gates as missing", () => {
    const readiness = getIntegrationReadiness({
      EMAIL_PROVIDER: "ses",
      SES_REGION: "GET_FROM_AWS",
      AWS_ROLE_ARN: "CHANGE_ME",
      EMAIL_FROM: "prodavnica@svetpovoljnihcena.rs",
      EMAIL_REPLY_TO: "podrska@svetpovoljnihcena.rs",
      MYGLS_ENABLED: "true",
      MYGLS_ENV: "production",
      MYGLS_PRODUCTION_ACCEPTED: "false",
    });
    const ses = readiness.find((item) => item.id === "ses");
    const mygls = readiness.find((item) => item.id === "mygls");

    expect(ses?.ready).toBe(false);
    expect(ses?.missing).toEqual([
      "SES_REGION",
      "AWS_ROLE_ARN",
      "EMAIL_MARKETING_FROM",
    ]);
    expect(mygls?.missing).toContain("MYGLS_PRODUCTION_ACCEPTED");
  });

  it("allows provider sandbox modes without production acceptance", () => {
    const readiness = getIntegrationReadiness({
      MYGLS_ENABLED: "true",
      MYGLS_ENV: "test",
      MYGLS_PRODUCTION_ACCEPTED: "false",
      MYGLS_USERNAME: "sandbox-user",
      MYGLS_PASSWORD: "sandbox-password",
      MYGLS_CLIENT_NUMBER: "123",
      MYGLS_SENDER_IDENTITY_CARD_NUMBER: "123456789",
      MYGLS_SENDER_IDENTITY_TYPE: "PIB",
      MYGLS_PICKUP_NAME: "DC",
      MYGLS_PICKUP_STREET: "Test",
      MYGLS_PICKUP_HOUSE_NUMBER: "1",
      MYGLS_PICKUP_CITY: "Beograd",
      MYGLS_PICKUP_POSTAL_CODE: "11000",
      MYGLS_PICKUP_CONTACT_NAME: "QA",
      MYGLS_PICKUP_CONTACT_PHONE: "+381600000000",
      FISCAL_PROVIDER: "badi",
      BADI_ENV: "sandbox",
      BADI_PRODUCTION_ACCEPTED: "false",
      BADI_API_KEY: "sandbox-key",
      BADI_API_SECRET: "sandbox-secret",
      BADI_CLIENT_ID: "sandbox-client",
      BADI_FISCAL_MODE: "public",
      FISCAL_TIN: "123456789",
      FISCAL_LOCATION_ID: "sandbox-location",
    });

    expect(readiness.find((item) => item.id === "mygls")?.ready).toBe(true);
    expect(readiness.find((item) => item.id === "badi")?.ready).toBe(true);
  });

  it("reports a complete SES setup without exposing environment values", () => {
    const roleArn = "arn:aws:iam::123456789012:role/ses-production";
    const ses = getIntegrationReadiness({
      EMAIL_PROVIDER: "ses",
      SES_REGION: "eu-central-1",
      AWS_ROLE_ARN: roleArn,
      EMAIL_FROM: "prodavnica@svetpovoljnihcena.rs",
      EMAIL_MARKETING_FROM: "ponude@svetpovoljnihcena.rs",
      EMAIL_REPLY_TO: "podrska@svetpovoljnihcena.rs",
    }).find((item) => item.id === "ses");

    expect(ses?.ready).toBe(true);
    expect(ses?.missing).toEqual([]);
    expect(JSON.stringify(ses)).not.toContain(roleArn);
  });

  it("accepts the Rabalux stock API key without exposing it", () => {
    const apiKey = "rabalux-stock-api-key-secret";
    const rabalux = getIntegrationReadiness({
      RABALUX_ENABLED: "true",
      RABALUX_CATALOG_USER: "catalog-user",
      RABALUX_CATALOG_PASS: "catalog-secret",
      RABALUX_STOCK_USER: "stock-user",
      RABALUX_STOCK_API_KEY: apiKey,
    }).find((item) => item.id === "rabalux");

    expect(rabalux?.ready).toBe(true);
    expect(rabalux?.missing).toEqual([]);
    expect(JSON.stringify(rabalux)).not.toContain(apiKey);
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
      X_EXPRESS_CODE_PREFIX: "AAA",
      X_EXPRESS_CHECK_ADDRESS_PATH: "/api/order/check-address",
      X_EXPRESS_CREATE_ORDER_PATH: "/api/order/add",
      X_EXPRESS_WEBHOOK_API_KEY: "webhook-secret",
      X_EXPRESS_CODE_RANGE_START: "850300001",
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

    const legacyFirstCode = getIntegrationReadiness({
      ...env,
      X_EXPRESS_CODE_RANGE_START: "850300000",
    }).find((item) => item.id === "x-express");
    expect(legacyFirstCode?.ready).toBe(true);
    expect(legacyFirstCode?.missing).not.toContain("X_EXPRESS_CODE_RANGE_START");

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

  it("reports a complete badi training setup as connected without enabling real receipts", () => {
    const env = {
      FISCAL_PROVIDER: "badi",
      BADI_ENV: "production",
      BADI_INVOICE_TYPE: "training",
      BADI_PRODUCTION_ACCEPTED: "false",
      BADI_API_KEY: "api-key",
      BADI_API_SECRET: "api-secret",
      FISCAL_TIN: "123456789",
      FISCAL_LOCATION_ID: "1234567",
      BADI_FISCAL_MODE: "vpfr",
      BADI_STORE_ID: "store-id",
      BADI_CASHIER_ID: "cashier-id",
      BADI_VPFR_PFX: "base64-pfx",
      BADI_VPFR_PASSWORD: "password",
      BADI_VPFR_PAC: "ABC123",
    };
    const badi = getIntegrationReadiness(env).find((item) => item.id === "badi");

    expect(badi?.ready).toBe(true);
    expect(badi?.missing).toEqual([]);
    expect(badi?.description).toContain("training režimu");

    const realReceipts = getIntegrationReadiness({
      ...env,
      BADI_INVOICE_TYPE: "normal",
    }).find((item) => item.id === "badi");
    expect(realReceipts?.ready).toBe(false);
    expect(realReceipts?.missing).toContain("BADI_PRODUCTION_ACCEPTED");
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
