import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PickingBarcode } from "@/components/admin/picking-barcode";

describe("picking barcode", () => {
  it.each(["0012345678905", "8605078600040", "AN1TEBG5XL"])(
    "renders bars and the unchanged identifier %s before client hydration",
    (value) => {
      const html = renderToStaticMarkup(createElement(PickingBarcode, { value }));
      expect(html).toContain(`aria-label="Bar kod ${value}"`);
      expect(html).toContain(`>${value}</span>`);
      expect(html.match(/fill="black"/g)!.length).toBeGreaterThan(20);
      expect(html).toContain('x="10"');
      expect(html).toContain('fill="white"');
    },
  );

  it("does not fabricate bars for missing or unsupported identifiers", () => {
    expect(renderToStaticMarkup(createElement(PickingBarcode, { value: null }))).toBe("<span>—</span>");
    const html = renderToStaticMarkup(createElement(PickingBarcode, { value: "čćž" }));
    expect(html).not.toContain("<svg");
    expect(html).toContain("Bar kod nije moguće prikazati");
    expect(html).toContain(">čćž</span>");
  });
});
