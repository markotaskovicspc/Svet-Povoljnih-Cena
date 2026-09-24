import "server-only";
import { db } from "@/lib/db";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import { AnanasClient } from "./client";
import { ananasDateRange, normalizeAnanasDocument } from "./documents";

export function ananasError(error: unknown) {
  // Provider bodies, tokens and customer details must not enter logs/UI.
  return error instanceof Error && /^(Ananas |PIB Ananas |Neispravan |Neispravna |Neto iznos |Za jedan uvoz)/.test(error.message)
    ? error.message.slice(0, 300) : "Ananas sinhronizacija nije uspela. Proverite vezu, pristup i format odgovora.";
}
export async function syncAnanasDocuments(from: Date, to: Date, source: "MANUAL" | "AUTO" = "MANUAL") {
  ananasDateRange(from.toISOString(), to.toISOString());
  const run = await db.ananasSyncRun.create({ data: { from, to, source, status: "RUNNING" } });
  try {
    const api = new AnanasClient();
    const sales = await api.documents("SALE", from, to);
    const refunds = await api.documents("REFUND", from, to);
    // Validate every receipt before writing any. Do not persist buyer PII.
    const documents = [
      ...sales.map(row => normalizeAnanasDocument(row, "SALE", MERCHANT_LEGAL_INFO.pib)),
      ...refunds.map(row => normalizeAnanasDocument(row, "REFUND", MERCHANT_LEGAL_INFO.pib)),
    ];
    // Atomic per period, deduplicated by provider document identity.
    await db.$transaction(async tx => {
      for (const data of documents) {
        await tx.ananasDocument.upsert({ where: { kind_externalId: { kind: data.kind, externalId: data.externalId } }, create: data, update: data });
      }
      await tx.ananasSyncRun.update({ where: { id: run.id }, data: { status: "SUCCESS", count: documents.length, finishedAt: new Date() } });
    }, { timeout: 90000 });
    return { count: documents.length, runId: run.id };
  } catch (error) {
    const message = ananasError(error);
    await db.ananasSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", error: message, finishedAt: new Date() } });
    throw new Error(message);
  }
}

export async function syncAnanasAutomatically(now = new Date()) {
  const latest = await db.ananasSyncRun.findFirst({ where: { source: "AUTO", status: "SUCCESS" }, orderBy: { to: "desc" } });
  const from = new Date(latest ? latest.to.getTime() - 7 * 86400000 : now.getTime() - 30 * 86400000);
  // After an outage advance in bounded chunks, with a 7-day overlap for late documents.
  const to = new Date(Math.min(now.getTime(), from.getTime() + 31 * 86400000));
  return syncAnanasDocuments(from, to, "AUTO");
}
