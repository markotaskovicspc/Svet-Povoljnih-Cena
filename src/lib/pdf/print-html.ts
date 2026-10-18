import "server-only";

import { envValue } from "@/lib/env";

/** Print the same self-contained HTML/CSS used by the ERP's label view. */
export async function renderPrintHtmlPdf(html: string, options: { productLabels?: boolean } = {}): Promise<Buffer> {
  // Load the PDF runtime only when printing. Checkout and admin routes import
  // the email worker too, and must not fail while loading an optional renderer.
  const [{ default: chromium }, { chromium: playwright }] = await Promise.all([
    import("@sparticuz/chromium"),
    import("playwright-core"),
  ]);
  const localExecutable = envValue("PDF_CHROMIUM_EXECUTABLE_PATH");
  const serverless = process.platform === "linux" && !localExecutable;
  const browser = await playwright.launch({
    headless: true,
    executablePath: localExecutable ??
      (serverless ? await chromium.executablePath() : undefined),
    args: serverless ? chromium.args : undefined,
    timeout: 30_000,
  });
  // Playwright's PDF operation has no per-call timeout. Closing this private
  // browser bounds a stalled render so the durable email job can retry.
  const deadline = setTimeout(() => {
    void browser.close().catch(() => undefined);
  }, 30_000);
  deadline.unref();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    // Labels contain inline SVG barcodes and no remote assets. Rendering must
    // never fetch a URL embedded in an address, note, or other order content.
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    await page.emulateMedia({ media: "print" });
    await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
    // A long consolidated packing list must remain on its buyer's label.
    // Measure real print layout; promote overflowing labels to a full A4 sheet.
    await page.evaluate(async (checkProductLabels) => {
      await document.fonts.ready;
      const labels = Array.from(document.querySelectorAll<HTMLElement>(".label:has(.packing-list)"));
      for (const label of labels) {
        if (label.scrollHeight <= label.clientHeight + 1) continue;
        const sheet = label.closest(".sheet");
        if (!sheet) continue;
        const ownSheet = document.createElement("main");
        ownSheet.className = "sheet packing-sheet";
        sheet.after(ownSheet);
        ownSheet.append(label);
        if (!sheet.querySelector(".label")) sheet.remove();
        if (label.scrollHeight > label.clientHeight + 1) {
          throw new Error("Spisak artikala ne staje na adresnicu. Proverite paket pre štampe.");
        }
      }
      if (checkProductLabels) {
        for (const label of document.querySelectorAll<HTMLElement>(".box-label:not(.empty)")) {
          const name = label.querySelector<HTMLElement>(".article-name")!;
          let size = 6.5;
          while (name.scrollHeight > name.clientHeight + 1 && size > 5.5) {
            size -= .25;
            name.style.fontSize = `${size}pt`;
          }
          const bounds = label.getBoundingClientRect();
          const fields = [...label.querySelectorAll<HTMLElement>(".article-name, .importer, .label-footer")];
          const image = label.querySelector<HTMLImageElement>("img");
          if (!image?.complete || !image.naturalWidth ||
              fields.some(field => field.scrollWidth > field.clientWidth + 1 || field.scrollHeight > field.clientHeight + 1 || field.getBoundingClientRect().bottom > bounds.bottom - 2)) {
            throw new Error(`PRINT_LABEL_OVERFLOW:${label.dataset.sku}`);
          }
        }
      }
    }, options.productLabels ?? false);
    return await page.pdf({
      format: "A4",
      preferCSSPageSize: true,
      printBackground: true,
    });
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
}
