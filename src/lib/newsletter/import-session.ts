import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { databaseIdentifier, db } from "@/lib/db";
import { CONTACT_IMPORT_BATCH_SIZE, normalizeImportEmail } from "./import-parser";
import { upsertImportedContactAudience, writeNewsletterContactChunk } from "./contact-import";

export const startContactImportSchema = z.object({
  id: z.uuid(), listName: z.string().trim().min(1).max(150).transform((value) => value.replace(/\s+/g, " ")),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), fileName: z.string().trim().min(1).max(160),
  totalContacts: z.number().int().min(1).max(100_000),
  consentEvidence: z.string().trim().min(5).max(500).nullable().default(null),
});
const importContactSchema = z.object({
  email: z.string().transform((value) => normalizeImportEmail(value)).pipe(z.string().min(1)),
  firstName: z.string().max(120).nullable(), lastName: z.string().max(120).nullable(),
  language: z.string().min(1).max(20), source: z.string().min(1).max(60),
  consented: z.boolean(), consentedAt: z.iso.datetime().nullable().refine((date) => !date || new Date(date).getTime() <= Date.now(), "Datum saglasnosti je u budućnosti."),
  rowNumber: z.number().int().min(1).max(100_001),
  customFields: z.record(z.string().min(1).max(80), z.string().max(4000)).refine((value) => Object.keys(value).length <= 50 && Buffer.byteLength(JSON.stringify(value)) <= 8192, "Previše dodatnih podataka za jedan kontakt."),
});
export const contactImportBatchSchema = z.object({
  id: z.uuid(), batch: z.number().int().min(0).max(499),
  contacts: z.array(importContactSchema).min(1).max(CONTACT_IMPORT_BATCH_SIZE),
}).refine((value) => new Set(value.contacts.map((contact) => contact.email)).size === value.contacts.length, "Paket sadrži duplirane adrese.");

export async function startContactImport(raw: unknown, actorId: string) {
  const input = startContactImportSchema.parse(raw);
  const session = await db.newsletterContactImport.upsert({ where: { id: input.id }, create: { ...input, actorId }, update: {} });
  if (session.actorId !== actorId || session.fingerprint !== input.fingerprint || session.listName !== input.listName || session.totalContacts !== input.totalContacts || session.consentEvidence !== input.consentEvidence) {
    throw new Error("Ovaj uvoz pripada drugom sadržaju ili administratoru. Pokrenite novi uvoz.");
  }
  return { id: session.id, nextBatch: session.nextBatch, importedCount: session.importedCount, complete: Boolean(session.completedAt) };
}

export async function importContactBatch(raw: unknown, actorId: string) {
  const input = contactImportBatchSchema.parse(raw);
  return db.$transaction(async (tx) => {
    // Serialize only this import. The checkpoint and all three contact writes commit together.
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM ${databaseIdentifier("NewsletterContactImport")} WHERE "id" = ${input.id} AND "actorId" = ${actorId} FOR UPDATE`);
    const session = await tx.newsletterContactImport.findUnique({ where: { id: input.id } });
    if (!session || session.actorId !== actorId) throw new Error("Uvoz nije pronađen.");
    if (input.batch < session.nextBatch) return { id: session.id, nextBatch: session.nextBatch, importedCount: session.importedCount, complete: Boolean(session.completedAt) };
    if (input.batch !== session.nextBatch || session.completedAt) throw new Error("Redosled paketa nije ispravan. Nastavite prethodni uvoz.");
    const expected = Math.min(CONTACT_IMPORT_BATCH_SIZE, session.totalContacts - session.importedCount);
    if (input.contacts.length !== expected) throw new Error("Broj kontakata u paketu ne odgovara proverenoj listi.");
    const now = new Date();
    await writeNewsletterContactChunk(tx, input.contacts, { actorId, listName: session.listName, fileName: session.fileName, importedAt: now, consentEvidence: session.consentEvidence });
    const importedCount = session.importedCount + input.contacts.length;
    const complete = importedCount === session.totalContacts;
    const nextBatch = session.nextBatch + 1;
    await tx.newsletterContactImport.update({ where: { id: session.id }, data: { nextBatch, importedCount, completedAt: complete ? now : null } });
    // Create the selectable list after the first chunk and refresh its eligible count on completion.
    const audience = input.batch === 0 || complete ? await upsertImportedContactAudience(tx, session.listName, actorId, now) : undefined;
    if (complete) await tx.auditLog.create({ data: { actorId, action: "newsletter.contactImport.complete", entity: "NewsletterContactImport", entityId: session.id, diff: { listName: session.listName, importedCount, audienceId: audience?.id } } });
    return { id: session.id, nextBatch, importedCount, complete, audience };
  }, { timeout: 30_000, maxWait: 10_000 });
}
