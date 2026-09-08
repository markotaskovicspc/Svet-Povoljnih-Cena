import { afterEach, describe, expect, it, vi } from "vitest";

describe("PDF runtime isolation", () => {
  afterEach(() => {
    vi.doUnmock("playwright-core");
    vi.resetModules();
  });

  it("keeps importing callers safe when the PDF runtime cannot load", async () => {
    vi.resetModules();
    vi.doMock("playwright-core", () => {
      throw new Error("Missing PDF runtime asset");
    });

    const renderer = await import("@/lib/pdf/print-html");
    expect(renderer.renderPrintHtmlPdf).toBeTypeOf("function");
    // Printing still reports the failure so the durable worker can retry it.
    await expect(renderer.renderPrintHtmlPdf("<p>Label</p>")).rejects.toThrow();
  });
});
