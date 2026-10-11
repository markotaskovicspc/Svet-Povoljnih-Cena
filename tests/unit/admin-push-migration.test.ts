import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("creates a private subscription table with unique endpoints and cascading admin deletion", async () => {
  const database = new PGlite();
  try {
    await database.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE "AdminUser" ("id" TEXT PRIMARY KEY);');
    await database.exec(readFileSync("prisma/migrations/20261011180000_admin_order_push/migration.sql", "utf8"));
    const security = await database.query<{ rls: boolean; anon: boolean; authenticated: boolean }>(`
      SELECT relrowsecurity AS rls,
        has_table_privilege('anon', '"AdminPushSubscription"', 'SELECT') AS anon,
        has_table_privilege('authenticated', '"AdminPushSubscription"', 'SELECT') AS authenticated
      FROM pg_class WHERE relname = 'AdminPushSubscription'
    `);
    expect(security.rows[0]).toEqual({ rls: true, anon: false, authenticated: false });
    await database.exec(`INSERT INTO "AdminUser" VALUES ('a1');
      INSERT INTO "AdminPushSubscription" (id, "adminUserId", endpoint, p256dh, auth, "updatedAt") VALUES ('s1', 'a1', 'https://web.push.apple.com/token', 'key', 'auth', NOW());`);
    await expect(database.exec(`INSERT INTO "AdminPushSubscription" (id, "adminUserId", endpoint, p256dh, auth, "updatedAt") VALUES ('s2', 'a1', 'https://web.push.apple.com/token', 'key', 'auth', NOW());`)).rejects.toThrow();
    await database.exec(`DELETE FROM "AdminUser" WHERE id = 'a1';`);
    expect((await database.query('SELECT * FROM "AdminPushSubscription"')).rows).toEqual([]);
  } finally { await database.close(); }
});
