import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESTRUCTIVE_CONFIRMATION,
  getSubmitConfirmation,
} from "../../src/components/admin/submit-button";

describe("admin submit confirmation", () => {
  it("automatically protects destructive submit buttons", () => {
    expect(getSubmitConfirmation(undefined, "destructive")).toBe(
      DEFAULT_DESTRUCTIVE_CONFIRMATION,
    );
  });

  it("uses a contextual confirmation when one is supplied", () => {
    expect(
      getSubmitConfirmation("Obrisati označeni zapis?", "destructive"),
    ).toBe("Obrisati označeni zapis?");
    expect(getSubmitConfirmation("Potvrditi promenu?", "ghost")).toBe(
      "Potvrditi promenu?",
    );
  });

  it("does not interrupt ordinary submit buttons", () => {
    expect(getSubmitConfirmation(undefined, "default")).toBeUndefined();
    expect(getSubmitConfirmation(undefined, "outline")).toBeUndefined();
  });
});
