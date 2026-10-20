import 'server-only';
import { db } from '@/lib/db';
import { type ExportQuery } from './contract';
/** All registered claims, including resolved/rejected; no customer or payment fields. */
export async function exportReclamations(q: ExportQuery) {
  return db.reclamation.findMany({
    where: { id: { gt: q.after }, createdAt: { gte: q.period.start, lt: q.period.endExclusive } },
    orderBy: { id: 'asc' }, take: q.limit + 1,
    select: { id: true, number: true, sku: true, quantity: true, createdAt: true },
  });
}
