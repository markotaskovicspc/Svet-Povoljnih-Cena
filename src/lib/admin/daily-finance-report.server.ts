import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ReportPeriod } from "@/lib/admin/report-period";

import { combineDailyFinance, type FinanceChannel, type DailyFinanceReportRow } from './daily-finance-report';
import { ananasMerchandiseItems } from './fiscal-merchandise';
export { summarizeDailyFinanceReport } from './daily-finance-report';
export type { DailyFinanceReportRow } from './daily-finance-report';

type DailyFinanceDatabaseRow = {
  day: string;
  proforma_count: number;
  proforma_gross: number;
  fiscal_sale_count: number;
  fiscal_sale_gross: number;
  fiscal_refund_count: number;
  fiscal_refund_gross: number;
};

export async function getDailyFinanceReport(
  period: ReportPeriod,
  channel: FinanceChannel = "ALL",
): Promise<DailyFinanceReportRow[]> {
  return db.$transaction(async tx => {
  const rows = await tx.$queryRaw<DailyFinanceDatabaseRow[]>(Prisma.sql`
    WITH days AS (
      SELECT generate_series(
        (${period.start} AT TIME ZONE 'Europe/Belgrade')::date,
        ((${period.endExclusive} AT TIME ZONE 'Europe/Belgrade')::date - 1),
        interval '1 day'
      )::date AS day
    ), proformas AS (
      SELECT
        (i."issuedAt" AT TIME ZONE 'Europe/Belgrade')::date AS day,
        COUNT(*)::int AS count,
        COALESCE(SUM(i.total), 0)::double precision AS gross
      FROM "Invoice" i
      WHERE i.kind = 'PROFORMA'
        AND i.status <> 'CANCELLED'
        AND i."issuedAt" >= ${period.start}
        AND i."issuedAt" < ${period.endExclusive}
      GROUP BY (i."issuedAt" AT TIME ZONE 'Europe/Belgrade')::date
    ), fiscal AS (
      SELECT
        (f."issuedAt" AT TIME ZONE 'Europe/Belgrade')::date AS day,
        COUNT(*) FILTER (WHERE f.kind = 'SALE')::int AS sale_count,
        COALESCE(SUM(f."totalGross") FILTER (WHERE f.kind = 'SALE'), 0)::double precision AS sale_gross,
        COUNT(*) FILTER (WHERE f.kind = 'REFUND')::int AS refund_count,
        COALESCE(SUM(f."totalGross") FILTER (WHERE f.kind = 'REFUND'), 0)::double precision AS refund_gross
      FROM "FiscalDocument" f
      WHERE f.status = 'ISSUED'
        AND f."issuedAt" >= ${period.start}
        AND f."issuedAt" < ${period.endExclusive}
      GROUP BY (f."issuedAt" AT TIME ZONE 'Europe/Belgrade')::date
    )
    SELECT
      to_char(days.day, 'YYYY-MM-DD') AS day,
      COALESCE(proformas.count, 0)::int AS proforma_count,
      COALESCE(proformas.gross, 0)::double precision AS proforma_gross,
      COALESCE(fiscal.sale_count, 0)::int AS fiscal_sale_count,
      COALESCE(fiscal.sale_gross, 0)::double precision AS fiscal_sale_gross,
      COALESCE(fiscal.refund_count, 0)::int AS fiscal_refund_count,
      COALESCE(fiscal.refund_gross, 0)::double precision AS fiscal_refund_gross
    FROM days
    LEFT JOIN proformas ON proformas.day = days.day
    LEFT JOIN fiscal ON fiscal.day = days.day
    ORDER BY days.day DESC
  `);
  const base = rows.map((row) => ({
    day: row.day,
    proformaCount: row.proforma_count,
    proformaGross: row.proforma_gross,
    fiscalSaleCount: row.fiscal_sale_count,
    fiscalSaleGross: row.fiscal_sale_gross,
    fiscalRefundCount: row.fiscal_refund_count,
    fiscalRefundGross: row.fiscal_refund_gross,
    fiscalNetGross: row.fiscal_sale_gross - row.fiscal_refund_gross,
  }));
  const [lines,documents] = await Promise.all([
    channel === 'ANANAS' ? Promise.resolve([]) : tx.fiscalDocumentLine.findMany({
      where:{fiscalDocument:{is:{status:'ISSUED',kind:{in:['SALE','REFUND']},issuedAt:{gte:period.start,lt:period.endExclusive}}}},
      select:{sku:true,shortName:true,qty:true,unitCogs:true,product:{select:{cogs:true}},originalSaleLine:{select:{unitCogs:true}},fiscalDocument:{select:{kind:true,issuedAt:true}}},
    }),
    channel === 'SPC' ? Promise.resolve([]) : tx.ananasDocument.findMany({where:{kind:{in:['SALE','REFUND']},issuedAt:{gte:period.start,lt:period.endExclusive}},select:{kind:true,issuedAt:true,gross:true,items:true}}),
  ]);
  const skus=[...new Set(documents.flatMap(doc=>ananasMerchandiseItems(doc.items).map(item=>item.sku)))];
  const products=skus.length ? await tx.product.findMany({where:{sku:{in:skus}},select:{sku:true,cogs:true}}) : [];
  return combineDailyFinance(base,lines.map(line=>({issuedAt:line.fiscalDocument.issuedAt!,kind:line.fiscalDocument.kind,sku:line.sku,name:line.shortName,qty:line.qty,unitCogs:line.unitCogs==null?null:Number(line.unitCogs),originalUnitCogs:line.originalSaleLine?.unitCogs==null?null:Number(line.originalSaleLine.unitCogs),currentCogs:line.product?.cogs==null?null:Number(line.product.cogs)})),documents.map(doc=>({...doc,gross:Number(doc.gross)})),new Map(products.map(product=>[product.sku,product.cogs==null?null:Number(product.cogs)])),channel);
  }, {isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000});
}
