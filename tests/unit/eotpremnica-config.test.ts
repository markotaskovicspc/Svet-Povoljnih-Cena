import { describe, expect, it } from "vitest";
import { resolveEotpremnicaGate } from "@/lib/eotpremnica/config";

describe("eOtpremnica production acceptance gate", () => {
  it("permits an explicitly enabled sandbox without a production flag", () => {
    expect(
      resolveEotpremnicaGate({
        EOTPREMNICA_ENABLED: "true",
        EOTPREMNICA_ENV: "sandbox",
        EOTPREMNICA_PRODUCTION_ACCEPTED: "false",
      }),
    ).toEqual({ allowed: true, mode: "sandbox" });
  });

  it("blocks production until acceptance is explicitly confirmed", () => {
    const blocked = resolveEotpremnicaGate({
      EOTPREMNICA_ENABLED: "true",
      EOTPREMNICA_ENV: "production",
      EOTPREMNICA_PRODUCTION_ACCEPTED: "false",
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.reason).toContain("PRODUCTION_ACCEPTED");

    expect(
      resolveEotpremnicaGate({
        EOTPREMNICA_ENABLED: "true",
        EOTPREMNICA_ENV: "production",
        EOTPREMNICA_PRODUCTION_ACCEPTED: "true",
      }),
    ).toEqual({ allowed: true, mode: "production" });
  });
});
