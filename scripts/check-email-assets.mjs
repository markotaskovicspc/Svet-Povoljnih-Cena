import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const dist = process.env.NEXT_DIST_DIR?.trim() || ".next";
const assets = [
  "public/documents/garantni-list-logo.jpeg",
  "public/documents/spc-pdf-geist-regular.ttf",
];
// Verify the produced server bundles, not just the source checkout. Files in
// public/ can exist on the CDN but be absent from Vercel's function filesystem.
for (const route of ["api/checkout/order", "api/cron/background-jobs"]) {
  const trace = resolve(dist, "server/app", route, "route.js.nft.json");
  const files = new Set(JSON.parse(readFileSync(trace, "utf8")).files.map((file) => resolve(dirname(trace), file)));
  for (const asset of assets) {
    const fullPath = resolve(asset);
    if (!existsSync(fullPath) || !files.has(fullPath)) {
      throw new Error(`Missing email PDF runtime asset for /${route}: ${asset}`);
    }
  }
}
console.log("Email PDF runtime assets verified in checkout and background worker bundles.");
