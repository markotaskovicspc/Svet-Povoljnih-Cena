import { describe, expect, it } from "vitest";
import { resolveChannelAvailability } from "@/lib/channel-availability";

describe("channel safety stock", () => {
  it("uses 0/10/20 thresholds for web, wholesale and export", () => {
    expect(
      resolveChannelAvailability({
        physical: 21,
        manualWeb: true,
        manualWholesale: true,
        manualExport: true,
      }),
    ).toEqual({ available: 21, web: true, wholesale: true, export: true });
    expect(
      resolveChannelAvailability({
        physical: 20,
        manualWeb: true,
        manualWholesale: true,
        manualExport: true,
      }).export,
    ).toBe(false);
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
