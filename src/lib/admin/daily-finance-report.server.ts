import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ReportPeriod } from "@/lib/admin/report-period";

export type DailyFinanceReportRow = {
  day: string;
  proformaCount: number;
  proformaGross: number;
  fiscalSaleCount: number;
  fiscalSaleGross: number;
  fiscalRefundCount: number;
  fiscalRefundGross: number;
  fiscalNetGross: number;
};

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
): Promise<DailyFinanceReportRow[]> {
  const rows = await db.$queryRaw<DailyFinanceDatabaseRow[]>(Prisma.sql`
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
  return rows.map((row) => ({
    day: row.day,
    proformaCount: row.proforma_count,
    proformaGross: row.proforma_gross,
    fiscalSaleCount: row.fiscal_sale_count,
    fiscalSaleGross: row.fiscal_sale_gross,
    fiscalRefundCount: row.fiscal_refund_count,
    fiscalRefundGross: row.fiscal_refund_gross,
    fiscalNetGross: row.fiscal_sale_gross - row.fiscal_refund_gross,
  }));
}

export function summarizeDailyFinanceReport(
  rows: readonly DailyFinanceReportRow[],
) {
  return rows.reduce(
    (total, row) => ({
      proformaCount: total.proformaCount + row.proformaCount,
      proformaGross: total.proformaGross + row.proformaGross,
      fiscalSaleCount: total.fiscalSaleCount + row.fiscalSaleCount,
      fiscalSaleGross: total.fiscalSaleGross + row.fiscalSaleGross,
      fiscalRefundCount: total.fiscalRefundCount + row.fiscalRefundCount,
      fiscalRefundGross: total.fiscalRefundGross + row.fiscalRefundGross,
      fiscalNetGross: total.fiscalNetGross + row.fiscalNetGross,
    }),
    {
      proformaCount: 0,
      proformaGross: 0,
      fiscalSaleCount: 0,
      fiscalSaleGross: 0,
      fiscalRefundCount: 0,
      fiscalRefundGross: 0,
      fiscalNetGross: 0,
    },
  );
}
