import { describe, expect, it } from "vitest";
import { actionGrossMarginPct } from "@/lib/pricing/action-bm";
import { grossMarginPct } from "@/lib/pricing/gross-margin";

describe("akcijska BM%", () => {
  it("računa maržu iz akcijske cene bez PDV-a i COGS-a", () => {
    expect(actionGrossMarginPct(1_200, 700)).toBe(30);
  });

  it("ne prikazuje izmišljenu maržu kada nema validne nabavne cene", () => {
    expect(actionGrossMarginPct(1_200, null)).toBeNull();
    expect(actionGrossMarginPct(0, 100)).toBeNull();
  });

  it("koristi istu centralnu formulu za svaku MP cenu", () => {
    expect(grossMarginPct(1_200, 700)).toBe(30);
    expect(grossMarginPct(1_200, 700, 0)).toBeCloseTo(41.67, 2);
  });
});
