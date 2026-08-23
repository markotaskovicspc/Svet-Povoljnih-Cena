import { describe, expect, it } from "vitest";
import { canCustomerCancelStatus } from "@/lib/orders/cancellation";

describe("customer order cancellation window", () => {
  it.each([
    "KREIRANO",
    "POTVRDJENO",
    "U_PRIPREMI",
    "SPREMNO_ZA_ISPORUKU",
    "U_ISPORUCI",
  ])(
    "allows %s while the server still separately guards fiscalization",
    (status) => {
      expect(canCustomerCancelStatus(status)).toBe(true);
      expect(canCustomerCancelStatus(status.toLowerCase())).toBe(true);
    },
  );

  it.each(["ISPORUCENO", "OTKAZANO", "VRACENO"])(
    "does not offer self-service cancellation for %s",
    (status) => {
      expect(canCustomerCancelStatus(status)).toBe(false);
    },
  );
});
