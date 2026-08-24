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
  previewNewsletterAudience,
} from "@/lib/newsletter/audience";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_IMPORT_ROWS = 100_000;
const CHUNK_SIZE = 1_000;

const HEADER_ALIASES = {
  email: ["email", "e-mail", "mail", "mejl", "email_adresa"],
  firstName: ["first_name", "firstname", "ime"],
  lastName: ["last_name", "lastname", "prezime"],
  consent: ["consent", "saglasnost", "opt_in", "newsletter_saglasnost"],
  consentedAt: [
    "consented_at",
    "consent_date",
    "datum_saglasnosti",
    "datum_prijave",
  ],
  source: ["source", "izvor"],
} as const;

const AFFIRMATIVE_CONSENT = new Set([
  "1",
  "true",
  "yes",
  "da",
  "granted",
  "active",
  "potvrdjeno",
  "potvrđeno",
]);

type ParsedContact = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  source: string;
  consented: boolean;
  consentedAt: Date | null;
  rowNumber: number;
};

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
  const marketingContactTable = databaseIdentifier("MarketingContact");
  const consentEventTable = databaseIdentifier("MarketingConsentEvent");
  const subscriberTable = databaseIdentifier("NewsletterSubscriber");
  const contactStatusType = databaseIdentifier("MarketingContactStatus");
  const consentEventType = databaseIdentifier("MarketingConsentEventType");

  for (let offset = 0; offset < parsed.contacts.length; offset += CHUNK_SIZE) {
    const chunk = parsed.contacts.slice(offset, offset + CHUNK_SIZE);
    const payload = chunk.map((row) => ({
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      source: row.source,
      consented: row.consented,
      consentedAt: (row.consentedAt ?? importedAt).toISOString(),
      rowNumber: row.rowNumber,
    }));
    const json = JSON.stringify(payload);

    await db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        WITH imported AS (
          SELECT *
          FROM jsonb_to_recordset(${json}::jsonb) AS x(
            email text,
            "firstName" text,
            "lastName" text,
            source text,
            consented boolean,
            "consentedAt" timestamptz,
            "rowNumber" integer
          )
        )
        INSERT INTO ${marketingContactTable} AS existing_contact (
          id, email, "firstName", "lastName", language, status, source, tags,
          "consentVersion", "subscribedAt", "confirmedAt", "createdAt", "updatedAt"
        )
        SELECT
          concat('nli_', md5(random()::text || clock_timestamp()::text || imported.email)),
          imported.email,
          imported."firstName",
          imported."lastName",
          'sr-Latn',
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
            'importedFile', ${safeFileName(file.name)}::text,
            'contactList', ${listName}::text,
            'rowNumber', imported."rowNumber",
            'explicitConsent', imported.consented
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
    });
  }

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
  const audiencePreview = await previewNewsletterAudience(filter, {
    includeContactsWithoutConsent: true,
  });
  const audience = await db.newsletterAudience.upsert({
    where: { name: audienceName },
    create: {
      name: audienceName,
      description: `Kontakti iz uvezene liste „${listName}”.`,
      filter: audienceFilterJson(filter),
      estimatedCount: audiencePreview.count,
      estimatedAt: importedAt,
      createdById: actorId,
      updatedById: actorId,
    },
    update: {
      description: `Kontakti iz uvezene liste „${listName}”.`,
      filter: audienceFilterJson(filter),
      estimatedCount: audiencePreview.count,
      estimatedAt: importedAt,
      updatedById: actorId,
    },
    select: { id: true, name: true, estimatedCount: true },
  });

  return { ...summary, audience };
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
      ? csvRows(await file.text())
      : null;
  if (!rows) throw new Error("Podržani su samo .csv i .xlsx fajlovi.");
  if (rows.length < 2) throw new Error("Fajl nema redove kontakata.");
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    throw new Error(`Fajl ima više od ${MAX_IMPORT_ROWS.toLocaleString("sr-Latn-RS")} redova.`);
  }

  const headers = rows[0]!.map(normalizeHeader);
  const indexes = resolveHeaders(headers);
  if (indexes.email < 0) throw new Error("Nedostaje obavezna kolona email.");

  const seen = new Set<string>();
  const contacts: ParsedContact[] = [];
  let invalidRows = 0;
  let duplicateRows = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const email = normalizeEmail(cell(row, indexes.email));
    if (!email) {
      if (row.some((value) => value.trim())) invalidRows += 1;
      continue;
    }
    if (seen.has(email)) {
      duplicateRows += 1;
      continue;
    }
    seen.add(email);
    const consentRaw = cell(row, indexes.consent).trim().toLocaleLowerCase("sr-Latn");
    const consented = AFFIRMATIVE_CONSENT.has(consentRaw);
    const consentedAt = consented
      ? parseConsentDate(cell(row, indexes.consentedAt))
      : null;
    contacts.push({
      email,
      firstName: cleanText(cell(row, indexes.firstName), 120),
      lastName: cleanText(cell(row, indexes.lastName), 120),
      source: cleanText(cell(row, indexes.source), 60) ?? "admin-import",
      consented,
      consentedAt,
      rowNumber: index + 1,
    });
  }
  if (!contacts.length) throw new Error("Nije pronađena nijedna ispravna email adresa.");
  return { contacts, totalRows: rows.length - 1, invalidRows, duplicateRows };
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

function csvRows(input: string) {
  const delimiter = detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function detectDelimiter(input: string) {
  const header = input.split(/\r?\n/, 1)[0] ?? "";
  return [...([';', ',', '\t'] as const)].sort(
    (left, right) => header.split(right).length - header.split(left).length,
  )[0];
}

function resolveHeaders(headers: string[]) {
  const find = (aliases: readonly string[]) =>
    headers.findIndex((header) => aliases.includes(header));
  return {
    email: find(HEADER_ALIASES.email),
    firstName: find(HEADER_ALIASES.firstName),
    lastName: find(HEADER_ALIASES.lastName),
    consent: find(HEADER_ALIASES.consent),
    consentedAt: find(HEADER_ALIASES.consentedAt),
    source: find(HEADER_ALIASES.source),
  };
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLocaleLowerCase("sr-Latn")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320
    ? email
    : null;
}

function parseConsentDate(value: string) {
  if (!value.trim()) return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function cleanText(value: string, max: number) {
  const clean = value.trim().replace(/\s+/g, " ").slice(0, max);
  return clean || null;
}

function cell(row: string[], index: number) {
  return index >= 0 ? row[index] ?? "" : "";
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
