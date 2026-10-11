import { z } from "zod";

export const carrierSchema = z.enum(["MYGLS", "X_EXPRESS"]);
export type Carrier = z.infer<typeof carrierSchema>;
export const carrierName = (provider: string | null) => provider === "MYGLS" ? "GLS" : "X Express";
export const statementRowSchema = z.object({
  kind: z.enum(["COST", "COD"]),
  trackingNo: z.string().trim().min(1).max(100),
  orderNumber: z.string().trim().max(100).optional(),
  bookedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Neispravan datum."),
  amount: z.number().finite().nonnegative().max(999999999),
  vatIncluded: z.boolean(),
  weightKg: z.number().finite().positive().max(1000).optional(),
  description: z.string().trim().max(500).optional(),
});
export type StatementRow = z.infer<typeof statementRowSchema>;
export const statementInputSchema = z.object({
  provider: carrierSchema,
  documentNo: z.string().trim().min(1).max(100),
  filename: z.string().trim().min(1).max(200),
  rows: z.array(statementRowSchema).min(1).max(2000),
});
export type StatementInput = z.infer<typeof statementInputSchema>;
export const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export function statementAmounts(row: StatementRow) {
  if (row.kind === "COD") return { net: money(row.amount), gross: money(row.amount) };
  return row.vatIncluded ? { net: money(row.amount / 1.2), gross: money(row.amount) }
    : { net: money(row.amount), gross: money(row.amount * 1.2) };
}

const glsWeights = [2, 3, 5, 10, 15, 20, 25, 30, 40];
const glsPrices = [
  [260, 290, 315, 375, 440, 520, 610, 690, 780],
  [200, 230, 255, 315, 380, 460, 550, 630, 720],
  [180, 210, 235, 295, 360, 440, 530, 610, 700],
];
/** Contract base only. Fuel, insurance, special services and returns need separate evidence. */
export function courierBaseCost(provider: Carrier, weightKg: number, parcels = 1, cod = false) {
  if (!Number.isFinite(weightKg) || weightKg <= 0 || !Number.isInteger(parcels) || parcels < 1) return null;
  let base: number;
  if (provider === "MYGLS") {
    // The signed GLS offer uses '<' boundaries; exactly 2/3/5/... kg enters the next band.
    const band = glsWeights.findIndex(limit => weightKg < limit);
    if (band < 0) return null;
    base = glsPrices[Math.min(parcels, 3) - 1][band];
  } else {
    base = weightKg <= 5 ? 240 : weightKg <= 10 ? 300 : weightKg <= 20 ? 450
      : weightKg <= 30 ? 700 : weightKg <= 50 ? 800 : 800 + Math.ceil(weightKg - 50) * 40.5;
  }
  return money(base + (cod ? 50 : 0));
}

export type MatchShipment = { id: string; orderNumber: string; trackingNo: string | null; parcelNumbers: unknown };
export function matchStatementRow(row: StatementRow, shipments: MatchShipment[]) {
  const matches = shipments.filter(shipment => {
    const numbers = [shipment.trackingNo, ...(Array.isArray(shipment.parcelNumbers) ? shipment.parcelNumbers : [])].map(String);
    return numbers.includes(row.trackingNo) && (!row.orderNumber || shipment.orderNumber === row.orderNumber);
  });
  return { shipmentId: matches.length === 1 ? matches[0].id : null,
    status: matches.length === 1 ? "MATCHED" as const : matches.length ? "AMBIGUOUS" as const : "UNMATCHED" as const };
}

export function codBalance(expected: number | null, remitted: number) {
  if (expected == null) return { difference: null, status: "UNKNOWN" as const };
  const difference = money(remitted - expected);
  return { difference, status: difference === 0 ? "SETTLED" as const : difference < 0 ? "SHORT" as const : "EXCESS" as const };
}
