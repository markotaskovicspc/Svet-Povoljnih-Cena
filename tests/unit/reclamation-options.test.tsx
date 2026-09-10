import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatReclamationDate, nextReclamationNumber, serializeReclamationHistory } from "@/lib/reclamation-options";
import { ReclamationHistory } from "@/components/reclamation-history";

describe("reclamation numbering and history", () => {
  it("uses the numeric maximum for the exact order, preserving gaps and large legacy sequences", () => {
    const order = "SPC-2026-000472";
    expect(nextReclamationNumber(order, [])).toBe(`R-1-${order}`);
    expect(nextReclamationNumber(order, [`R-9-${order}`, `R-12-${order}`, "R-99-another-order", "legacy-reference"]))
      .toBe(`R-13-${order}`);
    expect(nextReclamationNumber(order, [`R-9007199254740993-${order}`]))
      .toBe(`R-9007199254740994-${order}`);
  });

  it("uses the Belgrade date around midnight regardless of the runtime time zone", () => {
    const original = process.env.TZ;
    try {
      for (const zone of ["UTC", "Europe/Belgrade", "America/Los_Angeles"]) {
        process.env.TZ = zone;
        expect(formatReclamationDate("2026-09-10T22:05:00Z")).toBe("11. 9. 2026.");
        expect(formatReclamationDate("2026-01-10T23:05:00Z")).toBe("11. 1. 2026.");
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("shows only the safe history summary in newest-first order and never blocks another submission", () => {
    const rows = serializeReclamationHistory([
      { number: "R-1-SPC", createdAt: new Date("2026-09-01T10:00:00Z"), quantity: 1, status: "ODBIJENO" },
      { number: "R-2-SPC", createdAt: new Date("2026-09-02T10:00:00Z"), quantity: 2, status: "U_OBRADI" },
    ]);
    expect(rows[0].number).toBe("R-2-SPC");
    const html = renderToStaticMarkup(createElement(ReclamationHistory, { entries: rows }));
    expect(html).toContain("<details");
    expect(html).toContain("Prethodne reklamacije (2)");
    expect(html).toContain("Možete podneti novu prijavu");
    expect(html).toContain("Odbijeno");
    expect(html).toContain("2 kom");
    expect(html).not.toContain("<button");
    expect(renderToStaticMarkup(createElement(ReclamationHistory, { entries: [] }))).toBe("");
  });
});
