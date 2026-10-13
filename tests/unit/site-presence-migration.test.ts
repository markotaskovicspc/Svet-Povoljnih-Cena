import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
it('preserves existing subscriptions, defaults traffic opt-in off, and keeps the presence table private',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE TABLE "AdminPushSubscription" (id text);INSERT INTO "AdminPushSubscription" VALUES ('existing');`);
 await db.exec(await readFile(new URL('../../prisma/migrations/20261013213000_site_presence_alerts/migration.sql',import.meta.url),'utf8'));
 expect((await db.query('SELECT "trafficAlerts" FROM "AdminPushSubscription"')).rows).toEqual([{trafficAlerts:false}]);
 expect((await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname='SiteVisitorPresence'`)).rows).toEqual([{relrowsecurity:true}]);
 expect((await db.query(`SELECT has_table_privilege('anon','"SiteVisitorPresence"','SELECT') AS anon,has_table_privilege('authenticated','"SiteVisitorPresence"','SELECT') AS authenticated`)).rows).toEqual([{anon:false,authenticated:false}]);
 } finally { await db.close(); }
},30000);
