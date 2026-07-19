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
