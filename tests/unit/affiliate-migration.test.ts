import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("adds nullable order attribution, enforces partner links and denies API roles", async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE "Order" (id TEXT PRIMARY KEY); INSERT INTO "Order" VALUES (\'legacy\');');
    await db.exec(readFileSync("prisma/migrations/20261110103000_affiliate_partners/migration.sql", "utf8"));
    expect((await db.query('SELECT "affiliateClickId" FROM "Order" WHERE id = \'legacy\'')).rows).toEqual([{ affiliateClickId: null }]);
    await db.exec(`INSERT INTO "AffiliatePartner" (id,name,code) VALUES ('p','Partner','promo'); INSERT INTO "AffiliateClick" (id,"partnerId","expiresAt") VALUES ('click','p',NOW()+INTERVAL '30 days'); UPDATE "Order" SET "affiliateClickId"='click' WHERE id='legacy';`);
    await expect(db.exec(`INSERT INTO "AffiliatePartner" (id,name,code) VALUES ('other','Duplicate','promo')`)).rejects.toThrow();
    await expect(db.exec(`UPDATE "Order" SET "affiliateClickId"='fabricated'`)).rejects.toThrow();
    const result = await db.query<{ tablename: string; rowsecurity: boolean }>(`SELECT tablename,rowsecurity FROM pg_tables WHERE tablename IN ('AffiliatePartner','AffiliateClick')`);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every(row => row.rowsecurity)).toBe(true);
    await db.exec('SET ROLE anon');
    await expect(db.query('SELECT * FROM "AffiliatePartner"')).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE; SET ROLE authenticated');
    await expect(db.query('SELECT * FROM "AffiliateClick"')).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE; DELETE FROM "AffiliateClick" WHERE id=\'click\'');
    expect((await db.query('SELECT "affiliateClickId" FROM "Order"')).rows).toEqual([{ affiliateClickId: null }]);
  } finally { await db.close(); }
});
