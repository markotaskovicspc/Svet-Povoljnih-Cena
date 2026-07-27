import { describe, expect, it } from "vitest";
import { resolveReportPeriod } from "@/lib/admin/report-period";

describe("admin report period", () => {
  const julyNow = new Date("2026-07-27T10:00:00.000Z");

  it("includes only today's Belgrade calendar day", () => {
    const period = resolveReportPeriod({ range: "today" }, julyNow);

    expect(period.fromInput).toBe("2026-07-27");
    expect(period.toInput).toBe("2026-07-27");
    expect(period.start.toISOString()).toBe("2026-07-26T22:00:00.000Z");
    expect(period.endExclusive.toISOString()).toBe("2026-07-27T22:00:00.000Z");
  });

  it("builds inclusive preset periods without an extra day", () => {
    const period = resolveReportPeriod({ range: "7d" }, julyNow);

    expect(period.fromInput).toBe("2026-07-21");
    expect(period.toInput).toBe("2026-07-27");
  });

  it("uses the selected custom range and normalizes reversed dates", () => {
    const period = resolveReportPeriod(
      { range: "custom", from: "2026-07-20", to: "2026-07-10" },
      julyNow,
    );

    expect(period.preset).toBe("custom");
    expect(period.fromInput).toBe("2026-07-10");
    expect(period.toInput).toBe("2026-07-20");
  });

  it("uses the winter Belgrade offset for year-to-date", () => {
    const period = resolveReportPeriod({ range: "ytd" }, julyNow);

    expect(period.fromInput).toBe("2026-01-01");
    expect(period.start.toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });

  it("falls back to the 30-day preset for invalid custom input", () => {
    const period = resolveReportPeriod(
      { range: "custom", from: "2026-02-31", to: "not-a-date" },
      julyNow,
    );

    expect(period.preset).toBe("30d");
    expect(period.fromInput).toBe("2026-06-28");
  });
});
