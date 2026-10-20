import 'server-only';
import { db } from '@/lib/db';
import { type ExportQuery } from './contract';
/** All registered claims, including resolved/rejected; customer name only for the full-history journal; no contact/payment fields. */
export async function exportReclamations(q: ExportQuery) {
  return db.reclamation.findMany({
    where: { id: { gt: q.after }, ...(q.resource === 'spc-reclamations' ? { order: { channel: { not: 'ANANAS' as const } } } : {}), ...(q.history === 'all' ? {} : { createdAt: { gte: q.period.start, lt: q.period.endExclusive } }) },
    orderBy: { id: 'asc' }, take: q.limit + 1,
    select: { id: true, number: true, sku: true, quantity: true, createdAt: true, status: true, ...(q.history === 'all' ? { customerFirst: true, customerLast: true } : {}) },
  });
}
