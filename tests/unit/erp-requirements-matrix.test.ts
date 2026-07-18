import { describe, expect, it } from "vitest";
import { ERP_REQUIREMENTS } from "@/lib/admin/erp-requirements";

describe("ERP document requirements matrix", () => {
  it("tracks all 67 substantive document sections exactly once", () => {
    expect(ERP_REQUIREMENTS).toHaveLength(67);
    expect(ERP_REQUIREMENTS.map((item) => item.id)).toEqual(
      Array.from({ length: 67 }, (_, index) => index + 1),
    );
    expect(new Set(ERP_REQUIREMENTS.map((item) => item.acceptance)).size).toBe(67);
  });

  it("uses only final acceptance statuses and concrete admin routes", () => {
    for (const requirement of ERP_REQUIREMENTS) {
      expect(["implemented", "blocked_external"]).toContain(requirement.status);
      expect(requirement.route).toMatch(/^\/admin(?:\/|$)/);
      expect(requirement.note.length).toBeGreaterThan(10);
    }
  });

  it("keeps every external block explicit", () => {
    const blocked = ERP_REQUIREMENTS.filter(
      (item) => item.status === "blocked_external",
    );
    expect(blocked).toHaveLength(5);
    for (const requirement of blocked) {
      expect(requirement.note).toMatch(/čeka|isključen|nedostaj/i);
    }
  });
});
