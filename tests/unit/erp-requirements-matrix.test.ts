import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ERP_REQUIREMENTS } from "@/lib/admin/erp-requirements";

describe("ERP document requirements matrix", () => {
  it("tracks all 67 substantive document sections exactly once", () => {
    expect(ERP_REQUIREMENTS).toHaveLength(67);
    expect(ERP_REQUIREMENTS.map((item) => item.id)).toEqual(
      Array.from({ length: 67 }, (_, index) => index + 1),
    );
    expect(new Set(ERP_REQUIREMENTS.map((item) => item.acceptance)).size).toBe(67);
  });

  it("uses the four evidence statuses, concrete admin routes and declared test scenarios", () => {
    for (const requirement of ERP_REQUIREMENTS) {
      expect(["implemented", "partial", "blocked_external", "deferred_user"]).toContain(
        requirement.status,
      );
      expect(requirement.route).toMatch(/^\/admin(?:\/|$)/);
      expect(requirement.note.length).toBeGreaterThan(10);
      const [file, scenario] = requirement.evidence.split("#");
      expect(file).toMatch(/^tests\/(?:unit|integration|e2e)\//);
      const absoluteFile = resolve(process.cwd(), file!);
      expect(existsSync(absoluteFile)).toBe(true);
      expect(scenario).toBe(requirement.acceptance);
      expect(readFileSync(absoluteFile, "utf8"), requirement.evidence).toContain(
        `Acceptance: ${requirement.acceptance}`,
      );
    }
  });

  it("keeps every external block explicit", () => {
    const blocked = ERP_REQUIREMENTS.filter(
      (item) => item.status === "blocked_external",
    );
    expect(blocked.length).toBeGreaterThan(0);
    for (const requirement of blocked) {
      expect(requirement.note).toMatch(/čeka|isključen|nedostaj|spoljn/i);
    }
  });

  it("does not claim deferred work is implemented merely because its route exists", () => {
    const deferred = ERP_REQUIREMENTS.filter((item) => item.status === "deferred_user");
    expect(deferred.length).toBeGreaterThan(0);
    expect(deferred.map((item) => item.section)).toEqual(
      expect.arrayContaining(["Newsletter", "Viber kampanje", "Oglasi (GMS/Meta)", "KEP knjiga"]),
    );
  });
});

// Acceptance: BUY-06
// Acceptance: EXT-ANANAS-01
// Acceptance: ACC-01
// Acceptance: ACC-02
// Acceptance: ACC-03
// Acceptance: ACC-06
// Acceptance: CONTENT-02
// Acceptance: CONTENT-05
// Acceptance: CONTENT-07
// Acceptance: SERVICE-02
// Acceptance: IMPORT-01
// Acceptance: EXT-NEWS-01
// Acceptance: EXT-VIBER-01
// Acceptance: EXT-ADS-01
