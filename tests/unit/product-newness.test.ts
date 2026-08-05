import { describe, expect, it } from "vitest";
import {
  defaultProductNewUntil,
  omitSupplierProductNewnessUpdates,
  productNewUntilFloor,
  productNewUntilIsActive,
  productNewnessDateInput,
  resolveAdminImportedProductNewness,
} from "@/lib/product-newness";

describe("product newness", () => {
  it("adds four calendar months to the Belgrade first-publication date", () => {
    expect(
      productNewnessDateInput(
        defaultProductNewUntil(new Date("2026-08-05T12:00:00.000Z")),
      ),
    ).toBe("2026-12-05");
  });

  it("uses the Belgrade date when publication crosses the UTC day boundary", () => {
    expect(
      productNewnessDateInput(
        defaultProductNewUntil(new Date("2026-08-05T22:30:00.000Z")),
      ),
    ).toBe("2026-12-06");
  });

  it("clamps month-end dates instead of overflowing into the next month", () => {
    expect(
      productNewnessDateInput(
        defaultProductNewUntil(new Date("2026-10-31T12:00:00.000Z")),
      ),
    ).toBe("2027-02-28");
    expect(
      productNewnessDateInput(
        defaultProductNewUntil(new Date("2027-10-31T12:00:00.000Z")),
      ),
    ).toBe("2028-02-29");
  });

  it("keeps the expiry date inclusive in the Belgrade business day", () => {
    const newUntil = new Date("2026-08-01T00:00:00.000Z");

    expect(
      productNewUntilIsActive(
        newUntil,
        new Date("2026-07-31T22:30:00.000Z"),
      ),
    ).toBe(true);
    expect(
      productNewUntilIsActive(
        newUntil,
        new Date("2026-08-01T22:30:00.000Z"),
      ),
    ).toBe(false);
  });

  it("builds the catalog floor from today's Belgrade date", () => {
    expect(
      productNewUntilFloor(
        new Date("2026-07-31T22:30:00.000Z"),
      ).toISOString(),
    ).toBe("2026-08-01T00:00:00.000Z");
  });

  it("uses the automatic window for a new XLSX row without a Novo do column", () => {
    expect(
      resolveAdminImportedProductNewness({
        columnPresent: false,
        incomingNewUntil: null,
      }),
    ).toEqual({ newUntil: null, newUntilAutomatic: true });
  });

  it("treats an explicit XLSX date or blank cell as a manual decision", () => {
    const manualDate = new Date("2027-01-15T00:00:00.000Z");
    expect(
      resolveAdminImportedProductNewness({
        columnPresent: true,
        incomingNewUntil: manualDate,
      }),
    ).toEqual({ newUntil: manualDate, newUntilAutomatic: false });
    expect(
      resolveAdminImportedProductNewness({
        columnPresent: true,
        incomingNewUntil: null,
      }),
    ).toEqual({ newUntil: null, newUntilAutomatic: false });
  });

  it("preserves existing newness when XLSX omits the column", () => {
    const currentDate = new Date("2026-12-05T00:00:00.000Z");
    expect(
      resolveAdminImportedProductNewness({
        columnPresent: false,
        incomingNewUntil: null,
        existing: {
          newUntil: currentDate,
          newUntilAutomatic: true,
        },
      }),
    ).toEqual({ newUntil: currentDate, newUntilAutomatic: true });
  });

  it("removes all newness fields from recurring supplier updates", () => {
    expect(
      omitSupplierProductNewnessUpdates({
        name: "Nova lampa",
        fullPrice: 2_990,
        isNew: true,
        newUntil: new Date("2030-01-01T00:00:00.000Z"),
        newUntilAutomatic: true,
      }),
    ).toEqual({ name: "Nova lampa", fullPrice: 2_990 });
  });
});
