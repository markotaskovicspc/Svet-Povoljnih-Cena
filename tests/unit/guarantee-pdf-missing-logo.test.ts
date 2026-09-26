import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));

// Keep the real SVG renderer and PDF writer: the regression happened before
// dispatch when the runtime filesystem did not contain the public logo.
describe("guarantee PDF runtime assets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("still produces the complete attachment when the logo is missing", async () => {
    mocks.readFile.mockRejectedValue(Object.assign(new Error("missing logo"), { code: "ENOENT" }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { buildGuaranteePdf } = await import("@/lib/email/guarantee-pdf");
    const input = {
      number: "SPC-ASSET-REGRESSION",
      createdAt: new Date("2026-09-26T08:00:00Z"),
      items: [{ sku: "TEST-1", name: "Test proizvod", qty: 1 }],
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const pdf = await buildGuaranteePdf(input);
      expect(pdf.subarray(0, 8).toString()).toBe("%PDF-1.4");
      expect(pdf.toString("binary")).toContain("/Count 1");
      expect(pdf.length).toBeGreaterThan(50_000);
    }
    expect(warning).toHaveBeenCalledWith("[email:guarantee] Logo missing; using text header.");
    expect(mocks.readFile).toHaveBeenCalledTimes(2);
  });

  it("does not hide other filesystem failures or cache rejected promises", async () => {
    mocks.readFile.mockRejectedValue(Object.assign(new Error("access denied"), { code: "EACCES" }));
    const { buildGuaranteePdf } = await import("@/lib/email/guarantee-pdf");
    const input = {
      number: "SPC-ASSET-REGRESSION",
      createdAt: new Date("2026-09-26T08:00:00Z"),
      items: [{ sku: "TEST-1", name: "Test proizvod", qty: 1 }],
    };
    await expect(buildGuaranteePdf(input)).rejects.toThrow("access denied");
    await expect(buildGuaranteePdf(input)).rejects.toThrow("access denied");
    expect(mocks.readFile).toHaveBeenCalledTimes(2);
  });
});
