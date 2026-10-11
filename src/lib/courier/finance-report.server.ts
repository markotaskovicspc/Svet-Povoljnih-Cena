import "server-only";
import { db } from "@/lib/db";
import { type ReportPeriod, dateInputInTimeZone } from "@/lib/admin/report-period";
import { carrierSchema, courierBaseCost, codBalance, money } from "./finance";
import { expectedCod } from "./finance.server";

function packages(raw: unknown, provider: string | null): { weightKg: number; codAmount?: number }[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.courierFinancePackages)) return record.courierFinancePackages as { weightKg: number; codAmount?: number }[];
  if (provider === "X_EXPRESS" && Array.isArray(record.packages)) return record.packages.map(pkg => ({ weightKg: Number((pkg as { Mass?: unknown }).Mass) }));
  return [];
}
export async function courierFinanceReport(period: ReportPeriod, filter?: string) {
  const provider = carrierSchema.safeParse(filter);
  const providerWhere = provider.success ? { provider: provider.data } : { provider: { in: ["MYGLS", "X_EXPRESS"] } };
  const shipments = await db.shipment.findMany({ where: { ...providerWhere, status: { in: ["DELIVERED", "RETURNED"] }, OR: [{ deliveredAt: { gte: period.start, lt: period.endExclusive } }, { status: "RETURNED", lastStatusEventAt: { gte: period.start, lt: period.endExclusive } }, { events: { some: { status: { in: ["DELIVERED", "RETURNED"] }, occurredAt: { gte: period.start, lt: period.endExclusive } } } }] }, include: { order: { select: { id: true, number: true } }, courierStatementLines: true, events: { where: { status: { in: ["DELIVERED", "RETURNED"] } }, orderBy: { occurredAt: "asc" }, take: 1, select: { occurredAt: true } } }, take: 5001 });
  if (shipments.length > 5000) throw new Error("Izaberite kraći period (najviše 5000 pošiljki).");
  const rows = shipments.filter(s => {
    const date = s.events[0]?.occurredAt ?? s.deliveredAt ?? (s.status === "RETURNED" ? s.lastStatusEventAt : null);
    return date && date >= period.start && date < period.endExclusive && s.syncError !== "MyGLS etiketa obrisana.";
  }).map(s => {
    const expected = expectedCod(s);
    const submitted = packages(s.rawCreateResponse, s.provider);
    const originalCod = expectedCod({ ...s, status: "CREATED" });
    const prices = submitted.map((pkg, index) => courierBaseCost(s.provider as "MYGLS" | "X_EXPRESS", pkg.weightKg, submitted.length, pkg.codAmount != null ? pkg.codAmount > 0 : index === 0 && (originalCod ?? 0) > 0));
    const base = submitted.length === s.packageCount && prices.every(price => price != null) ? money(prices.reduce<number>((sum, price) => sum + (price ?? 0), 0)) : null;
    const costs = s.courierStatementLines.filter(line => line.kind === "COST");
    const actual = costs.length ? money(costs.reduce((sum, line) => sum + Number(line.amountNet), 0)) : null;
    const cod = money(s.courierStatementLines.filter(line => line.kind === "COD").reduce((sum, line) => sum + Number(line.amountGross), 0));
    return { id: s.id, orderId: s.orderId, orderNumber: s.order.number, provider: s.provider, trackingNo: s.trackingNo, status: s.status, date: dateInputInTimeZone((s.events[0]?.occurredAt ?? s.deliveredAt ?? s.lastStatusEventAt)!), base, actual, difference: base != null && actual != null ? money(actual - base) : null, expectedCod: expected, cod, codStatus: codBalance(expected, cod).status };
  });
  // Statement dates are DATE columns; use UTC calendar bounds, not timezone midnight.
  const dateBounds = { gte: new Date(`${period.fromInput}T00:00:00Z`), lte: new Date(`${period.toInput}T00:00:00Z`) };
  const lines = await db.courierStatementLine.findMany({ where: { bookedOn: dateBounds, statement: providerWhere }, include: { statement: { select: { provider: true, documentNo: true } } }, take: 10001 });
  if (lines.length > 10000) throw new Error("Izaberite kraći period (najviše 10000 stavki).");
  const fiscal = await db.fiscalDocument.findMany({ where: { status: "ISSUED", kind: { in: ["SALE", "REFUND"] }, issuedAt: { gte: period.start, lt: period.endExclusive }, lines: { some: { sku: "DOSTAVA" } } }, select: { kind: true, lines: { where: { sku: "DOSTAVA" }, select: { totalGross: true } }, order: { select: { shipments: { where: { purpose: "ORDER_DELIVERY", status: { not: "FAILED" }, OR: [{ syncError: null }, { syncError: { not: "MyGLS etiketa obrisana." } }] }, select: { provider: true } } } } } });
  const totals = ["MYGLS", "X_EXPRESS"].filter(p => !provider.success || provider.data === p).map(p => ({ provider: p, costNet: money(lines.filter(l => l.kind === "COST" && l.statement.provider === p).reduce((sum, l) => sum + Number(l.amountNet), 0)), cod: money(lines.filter(l => l.kind === "COD" && l.statement.provider === p).reduce((sum, l) => sum + Number(l.amountGross), 0)), fiscalShipping: money(fiscal.filter(d => { const carriers = new Set(d.order.shipments.map(s => s.provider)); return carriers.size === 1 && carriers.has(p); }).reduce((sum, d) => sum + d.lines.reduce((n, l) => n + Number(l.totalGross), 0) * (d.kind === "REFUND" ? -1 : 1), 0)) }));
  const unallocatedFiscal = money(fiscal.filter(d => new Set(d.order.shipments.map(s => s.provider)).size !== 1).reduce((sum, d) => sum + d.lines.reduce((n,l) => n + Number(l.totalGross), 0) * (d.kind === "REFUND" ? -1 : 1), 0));
  const legacyCount = await db.fiscalReceipt.count({ where: { fiscalizedAt: { gte: period.start, lt: period.endExclusive }, order: { fiscalDocuments: { none: { status: "ISSUED", kind: "SALE" } } } } });
  return { rows, totals, unallocatedFiscal, legacyCount, unmatched: lines.filter(l => !l.shipmentId).map(l => ({ id: l.id, trackingNo: l.trackingNo, kind: l.kind, amount: Number(l.amountGross), documentNo: l.statement.documentNo, provider: l.statement.provider })) };
}
