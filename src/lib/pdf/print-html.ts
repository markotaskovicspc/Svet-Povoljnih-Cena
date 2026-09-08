import "server-only";

import chromium from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";
import { envValue } from "@/lib/env";

/** Print the same self-contained HTML/CSS used by the ERP's label view. */
export async function renderPrintHtmlPdf(html: string): Promise<Buffer> {
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
