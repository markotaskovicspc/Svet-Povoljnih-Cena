import { expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
const mocks=vi.hoisted(()=>({query:vi.fn()}));
vi.mock("@/lib/db",()=>({db:{$queryRaw:mocks.query}}));
import { isStoredPhoneAllowed } from "@/lib/viber/audience";
it("ignores default false flags, honors explicit channel exclusions, re-enablement, and deleted accounts in real SQL",async()=>{
 const pg=new PGlite();
 try {
 await pg.exec(`CREATE TABLE "User" (id text,phone text,"deletedAt" timestamptz);
 CREATE TABLE "Order" ("userId" text,"shipPhone" text);
 CREATE TABLE "Customer" ("userId" text,phone text);
 CREATE TABLE "MarketingConsent" ("userId" text,sms boolean,viber boolean);
 CREATE TABLE "AuditLog" (id text,action text,entity text,"entityId" text,"createdAt" timestamptz);
 INSERT INTO "User" VALUES ('default','0637725045',NULL),('off','0641234567',NULL),('deleted','0651234567',now());
 INSERT INTO "MarketingConsent" VALUES ('default',false,false),('off',false,false);
 INSERT INTO "AuditLog" VALUES ('1','messaging.sms.disabled','User','off','2026-10-20T12:00:00Z');`);
 mocks.query.mockImplementation(async (s:{text:string;values:unknown[]})=>(await pg.query(s.text,s.values)).rows);
 expect(await isStoredPhoneAllowed('0637725045','SMS')).toBe(true);
 expect(await isStoredPhoneAllowed('0641234567','SMS')).toBe(false);
 expect(await isStoredPhoneAllowed('0641234567','VIBER')).toBe(true);
 expect(await isStoredPhoneAllowed('0651234567','VIBER')).toBe(false);
 await pg.exec(`INSERT INTO "AuditLog" VALUES ('2','messaging.sms.enabled','User','off','2026-10-20T13:00:00Z');`);
 expect(await isStoredPhoneAllowed('0641234567','SMS')).toBe(true);
 } finally {await pg.close();}
});
