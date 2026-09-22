import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PickingBarcode } from "@/components/admin/picking-barcode";

describe("picking barcode", () => {
  it.each(["0012345678905", "8605078600040", "AN1TEBG5XL"])(
    "prints the unchanged identifier %s in bold without bars",
    (value) => {
      const html = renderToStaticMarkup(createElement(PickingBarcode, { value }));
      expect(html).toBe(`<strong class="whitespace-nowrap font-mono font-bold">${value}</strong>`);
    },
  );

  it("shows a placeholder for a missing identifier", () => {
    const html = renderToStaticMarkup(createElement(PickingBarcode, { value: null }));
    expect(html).toContain(">—</strong>");
  });
});
