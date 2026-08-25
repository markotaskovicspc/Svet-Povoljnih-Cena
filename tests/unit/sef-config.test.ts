import { describe, expect, it } from "vitest";
import { requireSefConfig, resolveSefGate } from "@/lib/sef/config";

describe("SEF configuration", () => {
  it("blocks production until it is explicitly accepted", () => {
    const blocked = resolveSefGate({
      SEF_ENABLED: "true",
      SEF_ENV: "production",
      SEF_PRODUCTION_ACCEPTED: "false",
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.reason).toContain("PRODUCTION_ACCEPTED");
  });

  it("uses the official production origin without exposing the key", () => {
    expect(
      requireSefConfig({
        SEF_ENABLED: "true",
        SEF_ENV: "production",
        SEF_PRODUCTION_ACCEPTED: "true",
        SEF_API_KEY: "test-secret",
      }),
    ).toEqual({
      environment: "production",
      baseUrl: "https://efaktura.mfin.gov.rs",
      apiKey: "test-secret",
    });
  });

  it("rejects missing and placeholder credentials", () => {
    expect(() =>
      requireSefConfig({
        SEF_ENABLED: "true",
        SEF_ENV: "demo",
        SEF_API_KEY: "GET_FROM_AWS",
      }),
    ).toThrow("SEF_API_KEY");
  });
});
