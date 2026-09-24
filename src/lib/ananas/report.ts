import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
export async function getAnanasSummary(start: Date, endExclusive: Date) {
  const groups = await db.ananasDocument.groupBy({ by: ["kind"], where: { issuedAt: { gte: start, lt: endExclusive } }, _count: true, _sum: { gross: true, net: true, vat: true } });
  const sale = groups.find(g => g.kind === "SALE"), refund = groups.find(g => g.kind === "REFUND");
  const gross = new Prisma.Decimal(sale?._sum.gross ?? 0), corrections = new Prisma.Decimal(refund?._sum.gross ?? 0);
  return { sales: sale?._count ?? 0, refunds: refund?._count ?? 0, gross: gross.toNumber(), corrections: corrections.toNumber(), afterCorrections: gross.minus(corrections).toNumber(), vat: new Prisma.Decimal(sale?._sum.vat ?? 0).minus(refund?._sum.vat ?? 0).toNumber() };
}
