import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readShipmentAssignment } from "./shipment-assignment";
import { statementInputSchema, statementAmounts, matchStatementRow, money, type StatementRow, type StatementInput } from "./finance";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function statementIdentity(input: StatementInput) {
  const keyed = input.rows.map(row => ({ row, key: hash(JSON.stringify([row.kind, row.trackingNo, row.orderNumber ?? "", row.bookedOn, statementAmounts(row), row.weightKg ?? null, row.description ?? ""])) }));
  if (new Set(keyed.map(item => item.key)).size !== keyed.length) throw new Error("Datoteka sadrži duplirane stavke. Uklonite duplikate pre uvoza.");
  return { keyed, fingerprint: hash(keyed.map(item => item.key).sort().join("\n")) };
}
async function shipmentMatches(input: StatementInput, database: Prisma.TransactionClient = db) {
  const numbers = [...new Set(input.rows.map(row => row.trackingNo))];
  const orderNumbers = [...new Set(input.rows.flatMap(row => row.orderNumber ? [row.orderNumber] : []))];
  const shipments = await database.shipment.findMany({ where: { provider: input.provider, OR: [
    { trackingNo: { in: numbers } }, { order: { number: { in: orderNumbers } } },
    ...numbers.flatMap(number => [ { providerParcelNumbers: { array_contains: [number] } },
      ...(/^\d+$/.test(number) ? [{ providerParcelNumbers: { array_contains: [Number(number)] } }] : []) ]),
  ] }, select: { id: true, trackingNo: true, providerParcelNumbers: true, orderId: true, order: { select: { number: true } } } });
  const candidates = shipments.map(shipment => ({ id: shipment.id, trackingNo: shipment.trackingNo, parcelNumbers: shipment.providerParcelNumbers, orderNumber: shipment.order.number }));
  return input.rows.map(row => {
    const match = matchStatementRow(row, candidates);
    return { ...match, orderId: shipments.find(shipment => shipment.id === match.shipmentId)?.orderId ?? null };
  });
}
export async function previewStatement(raw: unknown) {
  const input = statementInputSchema.parse(raw);
  const identity = statementIdentity(input);
  const [matches, existing] = await Promise.all([
    shipmentMatches(input), db.courierStatement.findFirst({ where: { provider: input.provider, OR: [{ documentNo: input.documentNo }, { fingerprint: identity.fingerprint }] } }),
  ]);
  return { input, fingerprint: identity.fingerprint, existing: existing ? { id: existing.id, same: existing.fingerprint === identity.fingerprint } : null,
    rows: input.rows.map((row, index) => ({ ...row, ...matches[index], ...statementAmounts(row) })),
    costNet: money(input.rows.filter(row => row.kind === "COST").reduce((sum, row) => sum + statementAmounts(row).net, 0)),
    codGross: money(input.rows.filter(row => row.kind === "COD").reduce((sum, row) => sum + row.amount, 0)) };
}
export type StatementPreview = Awaited<ReturnType<typeof previewStatement>>;

export function expectedCod(shipment: { codAmount: unknown; rawCreateResponse: unknown; status: string; purpose: string }) {
  if (shipment.purpose === "RECLAMATION_RETURN" || shipment.status === "RETURNED") return 0;
  const value = shipment.codAmount ?? readShipmentAssignment(shipment.rawCreateResponse)?.codAmount;
  return value == null ? null : Number(value);
}
async function confirmOrderRemittances(tx: Prisma.TransactionClient, orderIds: string[]) {
  for (const orderId of [...new Set(orderIds)].sort()) {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const all = await tx.shipment.findMany({ where: { orderId, status: { not: "FAILED" }, purpose: { not: "RECLAMATION_RETURN" }, OR: [{ syncError: null }, { syncError: { not: "MyGLS etiketa obrisana." } }] },
      select: { codAmount: true, rawCreateResponse: true, status: true, purpose: true, courierStatementLines: { where: { kind: "COD" }, select: { amountGross: true, bookedOn: true } } } });
    const expected = all.map(expectedCod);
    if (!all.length || expected.some(value => value == null)) continue;
    const total = money(expected.reduce<number>((sum, value) => sum + (value ?? 0), 0));
    const remitted = money(all.flatMap(shipment => shipment.courierStatementLines).reduce((sum, line) => sum + Number(line.amountGross), 0));
    if (total > 0 && total === remitted) {
      const dates = all.flatMap(shipment => shipment.courierStatementLines).map(line => line.bookedOn.getTime());
      await tx.order.updateMany({ where: { id: orderId, courierPaidAt: null }, data: { courierPaidAt: new Date(Math.max(...dates)) } });
    }
  }
}
export async function importStatement(raw: unknown, fingerprint: string, actorId: string) {
  const input = statementInputSchema.parse(raw);
  const identity = statementIdentity(input);
  if (identity.fingerprint !== fingerprint) throw new Error("Specifikacija je promenjena. Ponovo otvorite pregled.");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`courier:${input.provider}`}))`;
    const existing = await tx.courierStatement.findFirst({ where: { provider: input.provider, OR: [{ documentNo: input.documentNo }, { fingerprint }] } });
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("Dokument sa ovim brojem već postoji sa drugačijim stavkama.");
      return { id: existing.id, alreadyImported: true, matched: 0 };
    }
    const matches = await shipmentMatches(input, tx);
    if (matches.some(match => match.status === "AMBIGUOUS")) throw new Error("Broj pošiljke odgovara više naloga. Ispravite podatke pre uvoza.");
    const statement = await tx.courierStatement.create({ data: { provider: input.provider, documentNo: input.documentNo, filename: input.filename, fingerprint, actorId } });
    await tx.courierStatementLine.createMany({ data: identity.keyed.map(({ row, key }, index) => {
      const amounts = statementAmounts(row);
      return { statementId: statement.id, lineKey: key, kind: row.kind, trackingNo: row.trackingNo, orderNumber: row.orderNumber || null,
        bookedOn: new Date(`${row.bookedOn}T00:00:00Z`), amountNet: amounts.net, amountGross: amounts.gross, weightKg: row.weightKg, description: row.description,
        shipmentId: matches[index].shipmentId };
    }) });
    await confirmOrderRemittances(tx, matches.flatMap(match => match.orderId ? [match.orderId] : []));
    return { id: statement.id, alreadyImported: false, matched: matches.filter(match => match.shipmentId).length };
  }, { timeout: 30000 });
}

export async function linkStatementLine(lineId: string, trackingNo: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "CourierStatementLine" WHERE id = ${lineId} FOR UPDATE`;
    const line = await tx.courierStatementLine.findUniqueOrThrow({ where: { id: lineId }, include: { statement: true } });
    if (line.shipmentId) throw new Error("Stavka je već povezana.");
    const row: StatementRow = { kind: line.kind as StatementRow["kind"], trackingNo, orderNumber: line.orderNumber ?? undefined, bookedOn: line.bookedOn.toISOString().slice(0, 10), amount: Number(line.amountGross), vatIncluded: true };
    const matches = await shipmentMatches({ provider: line.statement.provider as StatementInput["provider"], documentNo: line.statement.documentNo, filename: line.statement.filename, rows: [row] }, tx);
    if (!matches[0].shipmentId || !matches[0].orderId) throw new Error("Nije pronađen jedinstven nalog ovog kurira za navedeni broj i porudžbinu.");
    await tx.courierStatementLine.update({ where: { id: lineId }, data: { shipmentId: matches[0].shipmentId } });
    await confirmOrderRemittances(tx, [matches[0].orderId]);
    return line.statementId;
  });
}
