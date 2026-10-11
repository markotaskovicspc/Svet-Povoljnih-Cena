import { describe, expect, it } from "vitest";
import { formatRsd } from "@/lib/format";

describe("opt-in exact set currency formatting", () => {
  it("preserves ordinary catalog rounding by default", () => {
    expect(formatRsd(1000.49)).toBe("1.000 RSD");
    expect(formatRsd(1000.50)).toBe("1.001 RSD");
    expect(formatRsd(1000.49, false)).toBe("1.000 RSD");
  });
  it("displays exact set cents and grouped dinars", () => {
    expect(formatRsd(1000.49, true)).toBe("1.000,49 RSD");
    expect(formatRsd(1000.5, true)).toBe("1.000,50 RSD");
    expect(formatRsd(0.01, true)).toBe("0,01 RSD");
    expect(formatRsd(-1000.49, true)).toBe("-1.000,49 RSD");
  });
  it("does not add decimal noise to whole amounts or floating arithmetic", () => {
    expect(formatRsd(1000, true)).toBe("1.000 RSD");
    expect(formatRsd(0.1 + 0.2, true)).toBe("0,30 RSD");
    expect(formatRsd(999.9999999, true)).toBe("1.000 RSD");
  });
});
