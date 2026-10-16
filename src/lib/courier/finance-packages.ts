import { normalizeReturnParcelNumber, returnParcelNumbers } from '@/lib/admin/return-parcels';

type Package = { weightKg: number; codAmount?: number };
type Shipment = {
 id: string; provider: string | null; rawCreateResponse: unknown;
 trackingNo: string | null; providerParcelNumbers?: unknown; packageCount: number;
 pickupBatchLines?: { providerParcelNumber: string | null; weightKg: unknown }[];
};
/** Use historical shipment/locked packing evidence only, never today's catalog weight. */
export function courierFinancePackages(shipment: Shipment): Package[] {
 const raw = shipment.rawCreateResponse;
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
 const record = raw as Record<string, unknown>;
 if (Array.isArray(record.courierFinancePackages)) return record.courierFinancePackages as Package[];
 if (shipment.provider === 'X_EXPRESS' && Array.isArray(record.packages)) {
  return record.packages.map(pkg => ({ weightKg: Number(pkg?.Mass) }));
 }
 if (shipment.provider !== 'MYGLS') return [];
 const codes = returnParcelNumbers(shipment);
 const lines = shipment.pickupBatchLines ?? [];
 const assignments = Array.isArray(record.myGlsPackageAssignments) ? record.myGlsPackageAssignments : [];
 if (codes.length !== shipment.packageCount || !codes.length) return [];
 const result: Package[] = [];
 for (const code of codes) {
  const matching = lines.filter(line => line.providerParcelNumber && normalizeReturnParcelNumber(line.providerParcelNumber) === code);
  if (matching.length !== 1 || matching[0].weightKg == null) return [];
  const weightKg = Number(matching[0].weightKg);
  if (!Number.isFinite(weightKg) || weightKg <= 0) return [];
  const assigned = assignments.filter(entry => entry && (typeof entry.parcelNumber === 'string' || typeof entry.parcelNumber === 'number') && normalizeReturnParcelNumber(String(entry.parcelNumber)) === code);
  if (assigned.length !== 1 || typeof assigned[0].codAmount !== 'number' || !Number.isFinite(assigned[0].codAmount) || assigned[0].codAmount < 0) return [];
  result.push({weightKg, codAmount: assigned[0].codAmount});
 }
 return result;
}
