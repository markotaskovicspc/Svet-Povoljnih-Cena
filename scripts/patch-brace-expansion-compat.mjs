import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const commonJsEntry = require.resolve("brace-expansion");
const marker = "SPC brace-expansion CommonJS compatibility";
const source = await readFile(commonJsEntry, "utf8");

if (!source.includes(marker)) {
  const compatibilityFooter = `
/* ${marker} */
if (typeof module !== "undefined" && typeof exports.expand === "function") {
  const compatibleExpand = exports.expand;
  Object.assign(compatibleExpand, exports);
  module.exports = compatibleExpand;
}
`;

  await writeFile(commonJsEntry, `${source}${compatibilityFooter}`);
}
