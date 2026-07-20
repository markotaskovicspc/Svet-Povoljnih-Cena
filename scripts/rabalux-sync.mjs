import { readFile } from "node:fs/promises";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const mode = process.argv[2] ?? "inspect";
const args = new Map(
  process.argv.slice(3).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }),
);

if (mode === "inspect") {
  const [catalog, stock] = await Promise.all([
    loadInput(
      args.get("catalog"),
      "https://rabalux.rs/downloadmanager/downloadha/nohtml/1/id/332",
      "RABALUX_CATALOG_USER",
      "RABALUX_CATALOG_PASS",
    ),
    loadInput(
      args.get("stock"),
      "https://rabalux.hu/downloadmanager/downloadha/nohtml/1/id/11",
      "RABALUX_STOCK_USER",
      "RABALUX_STOCK_PASS",
    ),
  ]);
  const catalogSkus = matches(catalog, /<Sku>([^<]+)<\/Sku>/g);
  const stockRows = parseCsv(stock).slice(1).filter((row) => row[0]);
  const stockSkus = stockRows.map((row) => row[0].trim());
  const catalogSet = new Set(catalogSkus);
  const stockSet = new Set(stockSkus);
  const summary = {
    catalogRows: catalogSkus.length,
    stockRows: stockRows.length,
    catalogUnique: catalogSet.size,
    stockUnique: stockSet.size,
    invalidPrice: matches(catalog, /<Recommended_price>0(?:\.0+)?<\/Recommended_price>/g)
      .length,
    catalogOnly: [...catalogSet].filter((sku) => !stockSet.has(sku)).sort(),
    stockOnly: [...stockSet].filter((sku) => !catalogSet.has(sku)).sort(),
    videos: matches(catalog, /<Product_video>[^<]+<\/Product_video>/g).length,
    manuals: matches(catalog, /<Manual_pdf>[^<]+<\/Manual_pdf>/g).length,
    energyLabels: matches(catalog, /<Energylabel_pdf>[^<]+<\/Energylabel_pdf>/g)
      .length,
    fhdImages: matches(catalog, /_fhd\.(?:jpg|jpeg|png|webp)<\/Image>/gi).length,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(
    summary.catalogRows === 2_897 && summary.stockRows === 2_896 ? 0 : 1,
  );
}

if (!["catalog", "stock", "media"].includes(mode)) {
  throw new Error("Usage: rabalux-sync.mjs inspect|catalog|stock|media");
}
const secret = envValue("CRON_SECRET");
if (!secret) throw new Error("CRON_SECRET is not configured.");
const baseUrl = (
  envValue("NEXT_PUBLIC_BASE_URL") ??
  envValue("NEXTAUTH_URL") ??
  "http://127.0.0.1:3000"
).replace(/\/+$/, "");
const response = await fetch(`${baseUrl}/api/cron/rabalux/${mode}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});
const payload = await response.json();
console.log(JSON.stringify(payload, null, 2));
if (!response.ok || !payload.ok) process.exit(1);

async function loadInput(path, url, userName, passName) {
  if (path) return readFile(path, "utf8");
  const user = envValue(userName);
  const pass = envValue(passName);
  if (!user || !pass) {
    throw new Error(`${userName} and ${passName} are required without a local file.`);
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
    },
  });
  if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}.`);
  return response.text();
}

function envValue(name) {
  const value = process.env[name]?.trim();
  return value && !value.startsWith("GET_FROM_") ? value : null;
}

function matches(value, expression) {
  return [...value.matchAll(expression)].map((match) => match[1] ?? match[0]);
}

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];
    if (character === '"') {
      if (quoted && raw[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === ";" && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && raw[index + 1] === "\n") index++;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}
