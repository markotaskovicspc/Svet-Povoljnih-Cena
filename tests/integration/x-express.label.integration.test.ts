import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { renderXExpressLabelsHtml } from "@/lib/x-express/labels";

const screenshotPath = "/tmp/x-express-label-qa.png";
let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

describe("X Express label rendering", () => {
  it.fails("renders two 95x138 mm labels without clipped content", async () => {
    const html = renderXExpressLabelsHtml({
      id: "758bb513-499d-4ab1-8697-5e747602f222",
      trackingNo: "AAA0850300001",
      packageCount: 2,
      providerParcelNumbers: ["AAA0850300001", "AAA0850300002"],
      providerRouteCode: "SM-5",
      providerRouteName: "Šabac",
      rawCreateResponse: {
        packages: [
          { Code: "AAA0850300001", Mass: 1.8, Content: "Stolica" },
          { Code: "AAA0850300002", Mass: 2.2, Content: "Sto" },
        ],
      },
      createdAt: new Date("2026-08-25T12:00:00Z"),
      order: {
        number: "WEB-2026-0001",
        total: 12_345.67,
        paymentMethod: "POUZECE_GOTOVINA",
        shipFirstName: "Petar",
        shipLastName: "Petrović",
        shipPhone: "0642223344",
        shipStreet: "Severna transferzala bb",
        shipCity: "Šabac",
        shipPostalCode: "15000",
        notes: "Pozvati primaoca pre isporuke.",
        items: [{ name: "Stolica", qty: 1 }, { name: "Sto", qty: 1 }],
      },
    });
    const page = await browser.newPage({ viewport: { width: 1_200, height: 800 } });
    await page.setContent(html, { waitUntil: "load" });

    const labels = page.locator(".label");
    await expect(labels.count()).resolves.toBe(2);
    const measurements = await labels.evaluateAll((nodes) =>
      nodes.map((node) => {
        const element = node as HTMLElement;
        const box = element.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          horizontalOverflow: element.scrollWidth - element.clientWidth,
          verticalOverflow: element.scrollHeight - element.clientHeight,
        };
      }),
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    for (const label of measurements) {
      expect(label.width).toBeCloseTo(95 * (96 / 25.4), 0);
      expect(label.height).toBeCloseTo(138 * (96 / 25.4), 0);
      expect(label.horizontalOverflow).toBeLessThanOrEqual(0);
      expect(label.verticalOverflow).toBeLessThanOrEqual(0);
    }
    await page.close();
  });
});
