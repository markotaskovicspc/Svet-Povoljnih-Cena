import { describe, expect, it } from "vitest";
import { formatListingActionPeriod } from "@/lib/listing/action-period";

describe("period akcije u zaglavlju listinga", () => {
  it("prikazuje početak i kraj važenja", () => {
    expect(
      formatListingActionPeriod({
        label: "Akcijska ponuda",
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: "2026-08-31T21:59:59.999Z",
      }),
    ).toBe("Akcijska ponuda važi od 01.08.2026. do 31.08.2026.");
  });

  it("prikazuje kalendarski datum u Beogradu kada je UTC datum prethodni dan", () => {
    expect(
      formatListingActionPeriod({
        label: "Akcijska ponuda",
        startsAt: "2026-08-31T22:01:00.000Z",
        endsAt: "2026-09-30T21:59:00.000Z",
      }),
    ).toBe("Akcijska ponuda važi od 01.09.2026. do 30.09.2026.");
  });
});
