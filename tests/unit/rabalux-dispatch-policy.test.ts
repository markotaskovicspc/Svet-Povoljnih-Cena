import { describe, expect, it } from "vitest";
import { rabaluxCourierAvailableAt } from "@/lib/rabalux/dispatch-policy";

describe("Rabalux next-day courier scheduling", () => {
  it.each([
    ["2026-09-04T10:00:00Z", "2026-09-04T22:00:00.000Z"],
    ["2026-09-04T22:30:00Z", "2026-09-05T22:00:00.000Z"],
    ["2026-03-29T00:30:00Z", "2026-03-29T22:00:00.000Z"],
    ["2026-10-25T00:30:00Z", "2026-10-25T23:00:00.000Z"],
    ["2026-12-31T12:00:00Z", "2026-12-31T23:00:00.000Z"],
  ])("schedules %s for %s", (createdAt, expected) => {
    expect(rabaluxCourierAvailableAt(new Date(createdAt)).toISOString()).toBe(expected);
  });
});
