import { describe, expect, it } from "vitest";
import {
  DEFAULT_MONTHLY_ACTION_METADATA,
  normalizeMonthlyActionMetadata,
} from "@/lib/storefront/monthly-action-metadata";

describe("monthly action metadata", () => {
  it("uses the admin values after trimming", () => {
    expect(
      normalizeMonthlyActionMetadata({
        title: "  Avgustovska akcija  ",
        description: "  Popusti u avgustu.  ",
      }),
    ).toEqual({
      title: "Avgustovska akcija",
      description: "Popusti u avgustu.",
    });
  });

  it("falls back safely for missing or malformed settings", () => {
    expect(normalizeMonthlyActionMetadata(null)).toEqual(
      DEFAULT_MONTHLY_ACTION_METADATA,
    );
    expect(
      normalizeMonthlyActionMetadata({ title: "", description: 42 }),
    ).toEqual(DEFAULT_MONTHLY_ACTION_METADATA);
  });
});
