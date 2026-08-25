import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mergePdfDocuments } from "@/lib/pdf/merge";

describe("PDF merge", () => {
  it("keeps every source page in one ordered document", async () => {
    const first = await PDFDocument.create();
    first.addPage([595, 842]);
    first.addPage([595, 842]);
    const second = await PDFDocument.create();
    second.addPage([300, 400]);

    const mergedBytes = await mergePdfDocuments(
      [await first.save(), await second.save()],
      { title: "PRE-2026-0002 — kurirske etikete" },
    );
    const merged = await PDFDocument.load(mergedBytes);

    expect(merged.getPageCount()).toBe(3);
    expect(merged.getPages().map((page) => page.getSize())).toEqual([
      { width: 595, height: 842 },
      { width: 595, height: 842 },
      { width: 300, height: 400 },
    ]);
    expect(merged.getTitle()).toBe("PRE-2026-0002 — kurirske etikete");
  });

  it("rejects an empty print job", async () => {
    await expect(mergePdfDocuments([])).rejects.toThrow(
      "Nema PDF dokumenata za spajanje.",
    );
  });
});
