import "server-only";

import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const PDF_FONT_PATH = join(
  process.cwd(),
  "public",
  "documents",
  "spc-pdf-geist-regular.ttf",
);

/**
 * Rasterize an SVG with the font shipped with the application.
 *
 * Serverless runtimes do not guarantee that any system font is installed.
 * Loading only our bundled font prevents missing-glyph squares in customer
 * documents and keeps Serbian Latin and Cyrillic output deterministic.
 */
export async function renderPdfSvgToJpeg(svg: string, quality = 95) {
  const renderer = new Resvg(svg, {
    background: "#ffffff",
    fitTo: { mode: "original" },
    font: {
      fontFiles: [PDF_FONT_PATH],
      loadSystemFonts: false,
      defaultFontFamily: "Geist",
      sansSerifFamily: "Geist",
    },
    textRendering: 1,
  });

  return sharp(renderer.render().asPng())
    .jpeg({ quality, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
