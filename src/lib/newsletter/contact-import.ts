import "server-only";

import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { databaseIdentifier, db } from "@/lib/db";
import {
  NEWSLETTER_CONSENT_VERSION,
  NEWSLETTER_POLICY_VERSION,
} from "@/lib/newsletter/contacts";
import {
  audienceFilterJson,
  emptyAudienceFilter,
} from "@/lib/newsletter/audience";

import { contactTableFromRows, guessContactColumns, parseContactCsv, prepareContactImport, type ImportContact } from "./import-parser";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const CHUNK_SIZE = 1_000;

export type NewsletterContactImportPreview = {
  totalRows: number;
  uniqueValid: number;
  explicitConsent: number;
  withoutConsent: number;
  invalidRows: number;
  duplicateRows: number;
  samples: Array<{
    rowNumber: number;
    email: string;
    status: "ACTIVE" | "PENDING";
  }>;
};

export async function previewNewsletterContactImport(file: File) {
  const parsed = await parseContactFile(file);
  return preview(parsed);
}

export async function importNewsletterContacts(
  file: File,
  actorId: string,
  listNameRaw: string,
) {
  const parsed = await parseContactFile(file);
  const summary = preview(parsed);
  const listName = cleanListName(listNameRaw);
  const importedAt = new Date();
  for (let offset = 0; offset < parsed.contacts.length; offset += CHUNK_SIZE) {
    await db.$transaction((tx) => writeNewsletterContactChunk(tx, parsed.contacts.slice(offset, offset + CHUNK_SIZE), {
      actorId, listName, fileName: file.name, importedAt,
    }), { timeout: 30_000 });
  }
  const audience = await upsertImportedContactAudience(db, listName, actorId, importedAt);
  return { ...summary, audience };
}

export async function writeNewsletterContactChunk(
  tx: Prisma.TransactionClient,
  contacts: ImportContact[],
  { actorId, listName, fileName, importedAt, consentEvidence }: { actorId: string; listName: string; fileName: string; importedAt: Date; consentEvidence?: string | null },
) {
  const marketingContactTable = databaseIdentifier("MarketingContact");
  const consentEventTable = databaseIdentifier("MarketingConsentEvent");
  const subscriberTable = databaseIdentifier("NewsletterSubscriber");
  const contactStatusType = databaseIdentifier("MarketingContactStatus");
  const consentEventType = databaseIdentifier("MarketingConsentEventType");

  const json = JSON.stringify(contacts.map((row) => ({ ...row, consentedAt: row.consentedAt ?? importedAt.toISOString() })));
      await tx.$executeRaw(Prisma.sql`
        WITH imported AS (
          SELECT *
          FROM jsonb_to_recordset(${json}::jsonb) AS x(
            email text,
            "firstName" text,
            "lastName" text,
            source text,
            language text,
            "customFields" jsonb,
            consented boolean,
            "consentedAt" timestamptz,
            "rowNumber" integer
          )
        )
        INSERT INTO ${marketingContactTable} AS existing_contact (
          id, email, "firstName", "lastName", language, "customFields", status, source, tags,
          "consentVersion", "subscribedAt", "confirmedAt", "createdAt", "updatedAt"
        )
        SELECT
          concat('nli_', md5(random()::text || clock_timestamp()::text || imported.email)),
          imported.email,
          imported."firstName",
          imported."lastName",
          COALESCE(imported.language, 'sr-Latn'),
          COALESCE(imported."customFields", '{}'::jsonb),
          CASE WHEN imported.consented THEN 'ACTIVE'::${contactStatusType}
               ELSE 'PENDING'::${contactStatusType} END,
          imported.source,
          ARRAY[${listName}::text]::TEXT[],
          ${NEWSLETTER_CONSENT_VERSION}::text,
          CASE WHEN imported.consented THEN imported."consentedAt" ELSE NULL END,
          CASE WHEN imported.consented THEN imported."consentedAt" ELSE NULL END,
          ${importedAt}::timestamptz,
          ${importedAt}::timestamptz
        FROM imported
        ON CONFLICT (email) DO UPDATE SET
          "firstName" = COALESCE(EXCLUDED."firstName", existing_contact."firstName"),
          "lastName" = COALESCE(EXCLUDED."lastName", existing_contact."lastName"),
          source = COALESCE(existing_contact.source, EXCLUDED.source),
          "customFields" = COALESCE(existing_contact."customFields", '{}'::jsonb) || COALESCE(EXCLUDED."customFields", '{}'::jsonb),
          tags = ARRAY(
            SELECT DISTINCT tag
            FROM unnest(existing_contact.tags || EXCLUDED.tags) AS tag
          ),
          status = CASE
            WHEN existing_contact.status IN (
              'UNSUBSCRIBED'::${contactStatusType},
              'SUPPRESSED'::${contactStatusType}
            ) THEN existing_contact.status
            WHEN existing_contact.status = 'ACTIVE'::${contactStatusType}
              THEN existing_contact.status
            WHEN EXCLUDED.status = 'ACTIVE'::${contactStatusType}
              THEN EXCLUDED.status
            ELSE existing_contact.status
          END,
          "consentVersion" = CASE
            WHEN EXCLUDED.status = 'ACTIVE'::${contactStatusType}
              THEN EXCLUDED."consentVersion"
            ELSE existing_contact."consentVersion"
          END,
          "subscribedAt" = CASE
            WHEN existing_contact.status IN (
              'UNSUBSCRIBED'::${contactStatusType},
              'SUPPRESSED'::${contactStatusType}
            ) THEN existing_contact."subscribedAt"
            WHEN EXCLUDED.status = 'ACTIVE'::${contactStatusType}
              THEN COALESCE(existing_contact."subscribedAt", EXCLUDED."subscribedAt")
            ELSE existing_contact."subscribedAt"
          END,
          "confirmedAt" = CASE
            WHEN existing_contact.status IN (
              'UNSUBSCRIBED'::${contactStatusType},
              'SUPPRESSED'::${contactStatusType}
            ) THEN existing_contact."confirmedAt"
            WHEN EXCLUDED.status = 'ACTIVE'::${contactStatusType}
              THEN COALESCE(existing_contact."confirmedAt", EXCLUDED."confirmedAt")
            ELSE existing_contact."confirmedAt"
          END,
          "updatedAt" = ${importedAt}::timestamptz
      `);

      await tx.$executeRaw(Prisma.sql`
        WITH imported AS (
          SELECT *
          FROM jsonb_to_recordset(${json}::jsonb) AS x(
            email text,
            "firstName" text,
            "lastName" text,
            source text,
            language text,
            "customFields" jsonb,
            consented boolean,
            "consentedAt" timestamptz,
            "rowNumber" integer
          )
        )
        INSERT INTO ${consentEventTable} (
          id, "contactId", type, source, "consentVersion", "policyVersion",
          "actorId", evidence, "occurredAt"
        )
        SELECT
          concat('nle_', md5(random()::text || clock_timestamp()::text || contact.id)),
          contact.id,
          CASE WHEN imported.consented AND contact.status = 'ACTIVE'::${contactStatusType}
               THEN 'GRANTED'::${consentEventType}
               ELSE 'MIGRATED'::${consentEventType} END,
          imported.source,
          CASE WHEN imported.consented AND contact.status = 'ACTIVE'::${contactStatusType}
               THEN ${NEWSLETTER_CONSENT_VERSION}::text ELSE NULL END,
          CASE WHEN imported.consented AND contact.status = 'ACTIVE'::${contactStatusType}
               THEN ${NEWSLETTER_POLICY_VERSION}::text ELSE NULL END,
          ${actorId}::text,
          jsonb_build_object(
            'importedFile', ${safeFileName(fileName)}::text,
            'contactList', ${listName}::text,
            'rowNumber', imported."rowNumber",
            'explicitConsent', imported.consented,
            'consentEvidence', ${consentEvidence ?? null}::text
          ),
          CASE WHEN imported.consented THEN imported."consentedAt" ELSE ${importedAt}::timestamptz END
        FROM imported
        JOIN ${marketingContactTable} contact ON contact.email = imported.email
      `);

      await tx.$executeRaw(Prisma.sql`
        WITH imported AS (
          SELECT email
          FROM jsonb_to_recordset(${json}::jsonb) AS x(
            email text,
            "firstName" text,
            "lastName" text,
            source text,
            language text,
            "customFields" jsonb,
            consented boolean,
            "consentedAt" timestamptz,
            "rowNumber" integer
          )
        ), active AS (
          SELECT contact.email, contact.source
          FROM ${marketingContactTable} contact
          JOIN imported ON imported.email = contact.email
          WHERE contact.status = 'ACTIVE'::${contactStatusType}
        )
        INSERT INTO ${subscriberTable} (
          id, email, consent, source, "createdAt", "unsubscribedAt"
        )
        SELECT
          concat('nls_', md5(random()::text || clock_timestamp()::text || active.email)),
          active.email,
          true,
          active.source,
          ${importedAt}::timestamptz,
          NULL
        FROM active
        ON CONFLICT (email) DO UPDATE SET
          consent = true,
          "unsubscribedAt" = NULL
      `);
}

export async function upsertImportedContactAudience(client: Prisma.TransactionClient, listName: string, actorId: string, importedAt = new Date()) {

  const audienceName = `Lista — ${listName}`;
  const filter = {
    ...emptyAudienceFilter(),
    groups: [{
      id: "imported-list",
      logic: "AND" as const,
      rules: [{
        id: "imported-list-tag",
        field: "tag" as const,
        operator: "equals" as const,
        value: listName,
      }],
    }],
  };
  const eligible = await client.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS count FROM ${databaseIdentifier("MarketingContact")} c
    WHERE c."status" = 'ACTIVE' AND c."subscribedAt" IS NOT NULL AND ${listName} = ANY(c."tags")
      AND NOT EXISTS (SELECT 1 FROM ${databaseIdentifier("EmailSuppression")} s WHERE s."email" = c."email")
  `);
  const count = Number(eligible[0]?.count ?? 0);
  const audience = await client.newsletterAudience.upsert({
    where: { name: audienceName },
    create: {
      name: audienceName,
      description: `Kontakti iz uvezene liste „${listName}”.`,
      filter: audienceFilterJson(filter),
      estimatedCount: count,
      estimatedAt: importedAt,
      createdById: actorId,
      updatedById: actorId,
    },
    update: {
      description: `Kontakti iz uvezene liste „${listName}”.`,
      filter: audienceFilterJson(filter),
      estimatedCount: count,
      estimatedAt: importedAt,
      updatedById: actorId,
    },
    select: { id: true, name: true, estimatedCount: true },
  });

  return audience;
}

async function parseContactFile(file: File) {
  if (!file || file.size === 0) throw new Error("Izaberite CSV ili XLSX fajl.");
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error("Fajl je veći od dozvoljenih 20 MB.");
  }
  const extension = file.name.toLowerCase().split(".").pop();
  const rows = extension === "xlsx"
    ? await xlsxRows(file)
    : extension === "csv"
      ? parseContactCsv(await file.text())
      : null;
  if (!rows) throw new Error("Podržani su samo .csv i .xlsx fajlovi.");
  const table = contactTableFromRows(rows);
  const parsed = prepareContactImport(table, guessContactColumns(table.headers));
  return parsed;
}

function preview(parsed: Awaited<ReturnType<typeof parseContactFile>>): NewsletterContactImportPreview {
  const explicitConsent = parsed.contacts.filter((row) => row.consented).length;
  return {
    totalRows: parsed.totalRows,
    uniqueValid: parsed.contacts.length,
    explicitConsent,
    withoutConsent: parsed.contacts.length - explicitConsent,
    invalidRows: parsed.invalidRows,
    duplicateRows: parsed.duplicateRows,
    samples: parsed.contacts.slice(0, 10).map((row) => ({
      rowNumber: row.rowNumber,
      email: row.email,
      status: row.consented ? "ACTIVE" : "PENDING",
    })),
  };
}

async function xlsxRows(file: File) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    for (let column = 1; column <= row.cellCount; column += 1) {
      values.push(excelValue(row.getCell(column).value));
    }
    rows.push(values);
  });
  return rows;
}

function excelValue(value: ExcelJS.CellValue) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value) return String(value.text ?? "");
    if ("result" in value) return String(value.result ?? "");
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
  }
  return String(value);
}

function safeFileName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 160);
}

function cleanListName(value: string) {
  const clean = value.trim().replace(/\s+/g, " ").slice(0, 150);
  if (!clean) throw new Error("Unesite naziv liste kontakata.");
  return clean;
}
