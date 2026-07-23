import { describe, expect, it } from "vitest";
import {
  richTextPlainText,
  sanitizeRichText,
} from "@/lib/rich-text";

describe("article rich text", () => {
  it("preserves formatting tags while removing attributes and unsafe tags", () => {
    expect(
      sanitizeRichText(
        '<h2 onclick="alert(1)">Naslov</h2><p>Opis <strong>važan</strong></p><img src=x onerror=alert(1)>',
      ),
    ).toBe("<h2>Naslov</h2><p>Opis <strong>važan</strong></p>");
  });

  it("converts plain text to paragraphs and produces a clean preview", () => {
    const html = sanitizeRichText("Prvi red\nnastavak\n\nDrugi pasus");
    expect(html).toBe("<p>Prvi red<br>nastavak</p><p>Drugi pasus</p>");
    expect(richTextPlainText(html)).toBe("Prvi red\nnastavak\nDrugi pasus");
  });
});
