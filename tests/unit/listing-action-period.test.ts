import { describe, expect, it } from "vitest";
import { formatListingActionPeriod } from "@/lib/listing/action-period";

describe("period akcije u zaglavlju listinga", () => {
  it("prikazuje početak i kraj važenja", () => {
    expect(
      formatListingActionPeriod({
        label: "Akcijska ponuda",
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: "2026-08-31T23:59:59.999Z",
      }),
    ).toBe("Akcijska ponuda važi od 01.08.2026. do 31.08.2026.");
  });
});
