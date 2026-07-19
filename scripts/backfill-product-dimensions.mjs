import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const apply = process.argv.includes("--apply");
const dataPath = path.resolve("scripts/data/product-dimensions-2026-07-19.json");
const entries = JSON.parse(await fs.readFile(dataPath, "utf8"));
validateEntries(entries);

const connectionString = getConnectionString();
const adapter = new PrismaPg({
  connectionString: withDatabaseSsl(connectionString),
  max: 1,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 15_000,
});
const prisma = new PrismaClient({ adapter });

try {
  const products = await prisma.product.findMany({
    where: { sku: { in: entries.map((entry) => entry.sku) } },
    select: {
      id: true,
      sku: true,
      name: true,
      widthCm: true,
      depthCm: true,
      heightCm: true,
    },
  });
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const missing = entries.filter((entry) => !bySku.has(entry.sku));
  const conflicts = [];
  const pending = [];
  const unchanged = [];

  for (const entry of entries) {
    const product = bySku.get(entry.sku);
    if (!product) continue;
    const current = dimensions(product);
    const desired = dimensions(entry);
    if (sameDimensions(current, desired)) {
      unchanged.push(entry.sku);
    } else if (current.every((value) => value === null || value <= 0)) {
      pending.push({ entry, product, current, desired });
    } else {
      conflicts.push({ sku: entry.sku, current, desired });
    }
  }

  console.log(
    [
      `Product dimension backfill (${apply ? "apply" : "dry-run"})`,
      `source=${dataPath}`,
      `entries=${entries.length}`,
      `pending=${pending.length}`,
      `unchanged=${unchanged.length}`,
      `missing=${missing.length}`,
      `conflicts=${conflicts.length}`,
    ].join("\n"),
  );

  if (missing.length) {
    console.warn(`Missing products: ${missing.map((entry) => entry.sku).join(", ")}`);
  }
  for (const conflict of conflicts) {
    console.warn(
      `Conflict ${conflict.sku}: current=${display(conflict.current)} desired=${display(conflict.desired)}`,
    );
  }
  for (const item of pending) {
    console.log(`${item.entry.sku}: ${display(item.desired)} — ${item.product.name}`);
  }

  if (conflicts.length) {
    throw new Error("Refusing to apply while existing product dimensions conflict with the curated source.");
  }
  if (apply && pending.length) {
    await prisma.$transaction(
      pending.flatMap(({ entry, product, current }) => [
        prisma.product.update({
          where: { id: product.id },
          data: {
            widthCm: new Prisma.Decimal(entry.widthCm),
            depthCm: new Prisma.Decimal(entry.depthCm),
            heightCm: new Prisma.Decimal(entry.heightCm),
          },
        }),
        prisma.auditLog.create({
          data: {
            action: "catalog.dimensions_backfill",
            entity: "Product",
            entityId: product.id,
            diff: {
              sku: entry.sku,
              before: current,
              after: dimensions(entry),
              source: path.relative(process.cwd(), dataPath),
              sourceText: entry.sourceText,
              sourceOrder: entry.sourceOrder,
            },
          },
        }),
      ]),
      { timeout: 60_000 },
    );
    console.log(`Applied dimensions to ${pending.length} product(s).`);
  } else if (!apply) {
    console.log("Dry-run only. Re-run with --apply after reviewing the proposed mappings.");
  }
} finally {
  await prisma.$disconnect();
}

function validateEntries(items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Dimension source must be a non-empty JSON array.");
  }
  const skus = new Set();
  for (const entry of items) {
    if (!entry?.sku || skus.has(entry.sku)) throw new Error(`Invalid or duplicate SKU: ${entry?.sku}`);
    skus.add(entry.sku);
    for (const key of ["widthCm", "depthCm", "heightCm"]) {
      if (!Number.isFinite(entry[key]) || entry[key] <= 0 || entry[key] > 10_000) {
        throw new Error(`Invalid ${key} for SKU ${entry.sku}`);
      }
    }
    if (!entry.sourceText || !entry.sourceOrder) {
      throw new Error(`Missing source evidence for SKU ${entry.sku}`);
    }
  }
}

function getConnectionString() {
  const value = [
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
  ].find((candidate) => candidate?.trim());
  if (!value) throw new Error("A database connection string is required.");
  const url = new URL(value);
  if (url.port === "6543") {
    throw new Error("Refusing the transaction-pooler endpoint; use the session-mode port 5432 URL.");
  }
  return value;
}

function withDatabaseSsl(value) {
  const url = new URL(value);
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return value;
  const sslMode = process.env.DATABASE_SSLMODE?.trim() || url.searchParams.get("sslmode") || "require";
  url.searchParams.set("sslmode", sslMode);
  if (["prefer", "require", "verify-ca"].includes(sslMode.toLowerCase())) {
    url.searchParams.set("uselibpqcompat", "true");
  }
  return url.toString();
}

function dimensions(value) {
  return ["widthCm", "depthCm", "heightCm"].map((key) => {
    if (value[key] === null || value[key] === undefined) return null;
    return Number(value[key]);
  });
}

function sameDimensions(left, right) {
  return left.every((value, index) => value !== null && Math.abs(value - right[index]) < 0.001);
}

function display(values) {
  return values.map((value) => value ?? "—").join("×");
}
