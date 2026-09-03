import { describe, expect, it } from "vitest";
import {
  nativeValidationIssueMessage,
  nativeValidationSummary,
} from "@/lib/admin/native-validation";

describe("admin native validation messages", () => {
  it("keeps a concise message for one or more required fields", () => {
    expect(
      nativeValidationSummary([{ label: "Naziv", valueMissing: true }]),
    ).toBe("Popunite obavezno polje: „Naziv”.");
    expect(
      nativeValidationSummary([
        { label: "Naziv", valueMissing: true },
        { label: "Količina", valueMissing: true },
      ]),
    ).toBe("Popunite obavezna polja: „Naziv”, „Količina”.");
  });

  it("explains the actual maximum instead of calling an excessive value empty", () => {
    expect(
      nativeValidationSummary([
        { label: "Š", rangeOverflow: true, max: "60" },
      ]),
    ).toBe("Vrednost polja „Š” mora biti najviše 60.");
  });

  it("localizes decimal constraints and covers minimum and step errors", () => {
    expect(
      nativeValidationIssueMessage({
        label: "Težina",
        rangeUnderflow: true,
        min: "0.001",
      }),
    ).toBe("Vrednost polja „Težina” mora biti najmanje 0,001.");
    expect(
      nativeValidationIssueMessage({
        label: "Težina",
        stepMismatch: true,
        step: "0.001",
      }),
    ).toBe("Vrednost polja „Težina” mora biti uneta u koracima od 0,001.");
  });

  it("reports mixed validation problems without hiding either field", () => {
    expect(
      nativeValidationSummary([
        { label: "Š", rangeOverflow: true, max: "60" },
        { label: "V", valueMissing: true },
      ]),
    ).toBe(
      "Vrednost polja „Š” mora biti najviše 60. Popunite obavezno polje: „V”.",
    );
  });

  it("preserves an explicit custom validation message", () => {
    expect(
      nativeValidationIssueMessage({
        label: "SKU",
        customError: true,
        nativeMessage: "SKU već postoji.",
      }),
    ).toBe("SKU već postoji.");
  });
});
