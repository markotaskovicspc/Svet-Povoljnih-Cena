import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
it("keeps SEF XML private, separates environments and rejects duplicate outgoing invoice numbers", async () => {
  const sql = new PGlite();
  try {
    await sql.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE "Order" (id TEXT PRIMARY KEY);');
    await sql.exec(readFileSync("prisma/migrations/20261011200000_sef_documents/migration.sql", "utf8"));
    const security = await sql.query(`SELECT relrowsecurity AS rls, has_table_privilege('anon', '"SefDocument"', 'SELECT') AS anon, has_table_privilege('authenticated', '"SefDocument"', 'SELECT') AS authenticated FROM pg_class WHERE relname='SefDocument'`);
    expect(security.rows[0]).toEqual({ rls: true, anon: false, authenticated: false });
    const insert = (id: string, direction: string, environment = "production") => sql.query(`INSERT INTO "SefDocument" (id, direction, environment, number, "supplierName", "supplierPib", "customerName", "customerPib", "issueDate", net, vat, gross, xml, "updatedAt") VALUES ($1,$2,$3,'1','A','123456789','B','987654321',NOW(),100,20,120,'<xml/>',NOW())`, [id, direction, environment]);
    await insert("in1", "IN"); await insert("in2", "IN"); await insert("out1", "OUT");
    await expect(insert("out2", "OUT")).rejects.toThrow();
    await insert("out3", "OUT", "demo");
    await expect(insert("invalid", "X")).rejects.toThrow();
  } finally { await sql.close(); }
});
