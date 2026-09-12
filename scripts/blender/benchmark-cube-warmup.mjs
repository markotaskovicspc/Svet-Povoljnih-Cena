/** Lab: separates waiting before clicking from actual click-to-first-render latency. */
import { chromium, devices } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
const results = [];
for (const [device, warm] of [['Desktop Chrome', false], ['Desktop Chrome', true], ['Pixel 7', true], ['Desktop Chrome', true]]) {
  const context = await browser.newContext({ ...devices[device] });
  await context.addInitScript(warm => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: !warm, effectiveType: '4g' } });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
  }, warm);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3024/p/100010-6b45ec', { waitUntil: 'domcontentloaded' });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 500000, uploadThroughput: 125000 });
  const consent = page.getByRole('button', { name: 'Samo nužni', exact: true });
  if (await consent.isVisible()) await consent.click();
  const prepareStarted = Date.now();
  if (warm) await page.waitForFunction(() => !!document.querySelector('[data-ar-warm-ready]'), null, { timeout: 60000 });
  else await page.waitForLoadState('load');
  const waitBeforeClickMs = Date.now() - prepareStarted;
  const started = Date.now();
  await page.getByRole('button', { name: 'Otvori 3D pregled', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('model-viewer')?.loaded, null, { timeout: 60000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const clickToRenderMs = Date.now() - started;
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').filter(x => x.name.endsWith('cube-v5.glb')).map(x => ({ transferSize: x.transferSize, duration: x.duration })));
  const result = { device, warm, waitBeforeClickMs, clickToRenderMs, resources };
  results.push(result); console.log(result);
  if (warm) await page.screenshot({ path: `assets/cube-210030/qa/v6/${device === 'Pixel 7' ? 'mobile' : 'desktop'}-warm.png` });
  await context.close();
}
await writeFile('assets/cube-210030/qa/v6/warm-benchmark.json', JSON.stringify({ environment: 'Local Next dev, headless Chromium; 4 Mbps and 150 ms after navigation. Cold browser contexts. Device profiles simulate viewport/touch, not physical phone CPU. Warm cases explicitly wait for background preparation.', results }, null, 2));
await browser.close();
