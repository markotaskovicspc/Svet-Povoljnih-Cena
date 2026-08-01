import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

export function classifyCategoryGroupMismatches(categories, products) {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const categoryBySlug = new Map(
    categories.map((category) => [category.slug, category]),
  );

  const isAncestor = (candidate, target) => {
    const visited = new Set();
    let current = target;
    while (current?.parentId && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.parentId === candidate.id) return true;
      current = categoryById.get(current.parentId);
    }
    return false;
  };

  return products.flatMap((product) => {
    const target = product.group
      ? categoryBySlug.get(product.group.slug)
      : undefined;
    if (!target) return [];
    const current = product.categories.map((relation) => relation.category);
    if (current.some((category) => category.id === target.id)) return [];

    const safe =
      current.length === 0 ||
      current.every((category) => isAncestor(category, target));
    return [
      {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        groupName: product.group.name,
        groupSlug: product.group.slug,
        targetCategoryId: target.id,
        targetPath: target.path,
        currentCategoryIds: current.map((category) => category.id),
        currentPaths: current.map((category) => category.path),
        classification: safe ? "SAFE" : "ASK_MARKO",
        reason:
          current.length === 0
            ? "NO_PUBLIC_CATEGORY"
            : safe
              ? "CURRENT_IS_ANCESTOR"
              : "DIFFERENT_BRANCH_OR_LEAF",
      },
    ];
  });
}

async function main() {
  loadEnv({ path: ".env.local" });
  loadEnv();
  const applySafe = process.argv.includes("--apply-safe");
  const reportArg = process.argv.find((argument) => argument.startsWith("--report="));
  const reportPath = path.resolve(
    reportArg?.slice("--report=".length) ||
      "output/category-group-category-repair.json",
  );
  const connectionString =
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) throw new Error("Nedostaje DATABASE_URL.");

  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: withDatabaseSsl(connectionString),
      max: 1,
      connectionTimeoutMillis: 15_000,
    }),
    transactionOptions: { maxWait: 5_000, timeout: 30_000 },
  });

  try {
    const before = await loadRepairData(db);
    const mismatches = classifyCategoryGroupMismatches(
      before.categories,
      before.products,
    );
    const safe = mismatches.filter((row) => row.classification === "SAFE");
    const askMarko = mismatches.filter(
      (row) => row.classification === "ASK_MARKO",
    );
    const applied = [];
    const skippedAfterRecheck = [];

    if (applySafe) {
      await db.$transaction(async (tx) => {
        for (const candidate of safe) {
          const fresh = await loadOneProduct(tx, candidate.productId);
          const freshRows = fresh
            ? classifyCategoryGroupMismatches(before.categories, [fresh])
            : [];
          const confirmed = freshRows.find(
            (row) =>
              row.classification === "SAFE" &&
              row.targetCategoryId === candidate.targetCategoryId,
          );
          if (!confirmed) {
            skippedAfterRecheck.push(candidate.sku);
            continue;
          }
          await tx.productCategory.deleteMany({
            where: { productId: candidate.productId },
          });
          await tx.productCategory.create({
            data: {
              productId: candidate.productId,
              categoryId: candidate.targetCategoryId,
            },
          });
          applied.push(candidate.sku);
        }
      });
    }

    const after = await loadRepairData(db);
    const remaining = classifyCategoryGroupMismatches(
      after.categories,
      after.products,
    );
    const report = {
      mode: applySafe ? "APPLY_SAFE" : "DRY_RUN",
      generatedAt: new Date().toISOString(),
      before: {
        total: mismatches.length,
        safe: safe.length,
        askMarko: askMarko.length,
      },
      applied,
      skippedAfterRecheck,
      remaining: {
        total: remaining.length,
        safe: remaining.filter((row) => row.classification === "SAFE").length,
        askMarko: remaining.filter((row) => row.classification === "ASK_MARKO")
          .length,
        rows: remaining,
      },
    };
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    if (!applySafe) {
      console.log(
        "Dry-run je završen. Pokrenite istu komandu sa --apply-safe tek nakon pregleda izveštaja.",
      );
    }
  } finally {
    await db.$disconnect();
  }
}

async function loadRepairData(db) {
  // The project deliberately keeps the pool at one connection. Sequential
  // reads avoid adapter stalls seen when multiple Prisma operations compete
  // for that single session-mode connection.
  const categories = await db.category.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      path: true,
      parentId: true,
    },
  });
  const products = await db.product.findMany({
    where: { groupId: { not: null } },
    select: {
      id: true,
      sku: true,
      name: true,
      group: { select: { name: true, slug: true } },
      categories: {
        select: {
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              path: true,
              parentId: true,
            },
          },
        },
      },
    },
    orderBy: { sku: "asc" },
  });
  return { categories, products };
}

async function loadOneProduct(db, productId) {
  return db.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      sku: true,
      name: true,
      group: { select: { name: true, slug: true } },
      categories: {
        select: {
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              path: true,
              parentId: true,
            },
          },
        },
      },
    },
  });
}

function withDatabaseSsl(value) {
  try {
    const url = new URL(value);
    if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      url.searchParams.set("sslmode", process.env.DATABASE_SSLMODE || "require");
      url.searchParams.set("uselibpqcompat", "true");
    }
    return url.toString();
  } catch {
    return value;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
