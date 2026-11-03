import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("extends the existing scope constraint without losing group/product rules", async () => {
  const db = new PGlite();
  try {
    // Reproduce the actual pre-category constraint from migration 0082.
    await db.exec(`
      CREATE TABLE "Category" (id TEXT PRIMARY KEY);
      CREATE TABLE "RecommendationRule" (
        id TEXT PRIMARY KEY, "groupId" TEXT, "sourceProductId" TEXT,
        CONSTRAINT "RecommendationRule_exactly_one_scope_check"
          CHECK (num_nonnulls("groupId", "sourceProductId") = 1)
      );
      INSERT INTO "RecommendationRule" VALUES ('group-rule', 'group', NULL), ('product-rule', NULL, 'product');
      INSERT INTO "Category" VALUES ('appliances');
    `);
    for (const migration of [
      "20261103190000_recommendation_category_scope",
      "20261103194000_recommendation_category_scope_check",
    ]) {
      await db.exec(readFileSync(new URL(`../../prisma/migrations/${migration}/migration.sql`, import.meta.url), "utf8"));
    }

    await db.exec(`INSERT INTO "RecommendationRule" (id, "categoryId") VALUES ('category-rule', 'appliances')`);
    await db.exec(`UPDATE "RecommendationRule" SET "groupId" = NULL, "categoryId" = 'appliances' WHERE id = 'group-rule'`);
    expect((await db.query(`SELECT id FROM "RecommendationRule" ORDER BY id`)).rows).toEqual([
      { id: "category-rule" }, { id: "group-rule" }, { id: "product-rule" },
    ]);
    await expect(db.exec(`INSERT INTO "RecommendationRule" (id) VALUES ('empty')`)).rejects.toThrow();
    await expect(db.exec(`INSERT INTO "RecommendationRule" (id, "categoryId", "groupId") VALUES ('mixed', 'appliances', 'group')`)).rejects.toThrow();
    await expect(db.exec(`INSERT INTO "RecommendationRule" (id, "categoryId") VALUES ('missing', 'unknown')`)).rejects.toThrow();
    await db.exec(`DELETE FROM "Category" WHERE id = 'appliances'`);
    expect((await db.query(`SELECT id FROM "RecommendationRule"`)).rows).toEqual([{ id: "product-rule" }]);
  } finally {
    await db.close();
  }
});
