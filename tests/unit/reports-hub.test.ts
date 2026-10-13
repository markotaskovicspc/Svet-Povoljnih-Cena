import { describe, expect, it } from "vitest";
import { reportDestinationsForRole } from "@/lib/admin/reports-hub";

describe("admin reports hub permissions", () => {
  it.each([
    ["OPS", ["Ananas porudžbine", "Performans artikala", "Order bump", "Dnevni promet", "Knjigovodstveni izveštaji", "Posete i konverzije"]],
    ["ADS", ["Order bump", "Posete i konverzije", "3D i AR", "Exit-intent ponuda"]],
    ["CONTENT", ["QA objave"]],
    [
      "SUPER",
      [
        "Ananas porudžbine",
        "Performans artikala",
        "Order bump",
        "Dnevni promet",
        "Knjigovodstveni izveštaji",
        "Posete i konverzije",
        "3D i AR",
        "Exit-intent ponuda",
        "QA objave",
        "Audit log",
      ],
    ],
  ] as const)("shows only allowed destinations to %s", (role, expected) => {
    expect(reportDestinationsForRole(role).map((item) => item.title)).toEqual(
      expected,
    );
  });
});
