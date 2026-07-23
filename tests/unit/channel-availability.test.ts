import { describe, expect, it } from "vitest";
import { resolveChannelAvailability } from "@/lib/channel-availability";

describe("channel safety stock", () => {
  it("uses 0/10/20 thresholds for web, wholesale and export", () => {
    const at = (physical: number) =>
      resolveChannelAvailability({
        physical,
        manualWeb: true,
        manualWholesale: true,
        manualExport: true,
      });
    expect(at(0)).toEqual({ available: 0, web: false, wholesale: false, export: false });
    expect(at(1)).toEqual({ available: 1, web: true, wholesale: false, export: false });
    expect(at(10)).toEqual({ available: 10, web: true, wholesale: false, export: false });
    expect(at(11)).toEqual({ available: 11, web: true, wholesale: true, export: false });
    expect(at(20)).toEqual({ available: 20, web: true, wholesale: true, export: false });
    expect(at(21)).toEqual({ available: 21, web: true, wholesale: true, export: true });
  });

  it("always honours a manual channel disable", () => {
    const result = resolveChannelAvailability({
      physical: 100,
      reserved: 10,
      manualWeb: false,
      manualWholesale: false,
      manualExport: false,
    });
    expect(result).toEqual({
      available: 90,
      web: false,
      wholesale: false,
      export: false,
    });
  });
});
