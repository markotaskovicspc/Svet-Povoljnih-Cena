import { describe, it, expect } from 'vitest';
import { canonicalReturnParcel, reclamationParcelQuantity } from '@/lib/admin/return-receipt-plan';
const shipment = { id: 's', provider: 'MYGLS', packageCount: 2, providerParcelNumbers: [9002838514, 9002838515], rawCreateResponse: { myGlsPackageAssignments: [
  { orderItemId: 'i', parcelNumber: 9002838514, packedQuantity: 1 },
  { orderItemId: 'i', parcelNumber: 9002838515, packedQuantity: 1 },
] } };
describe('scanned return contents', () => {
  it('receives only the item quantity mapped to the selected parcel', () => {
    expect(reclamationParcelQuantity(shipment, { id: 'i', sku: 'chair', qty: 2 }, '09002838514')).toBe(1);
  });
  it('refuses incomplete or unrelated packing evidence', () => {
    expect(() => reclamationParcelQuantity(shipment, { id: 'i', sku: 'chair', qty: 3 }, '9002838514')).toThrow('pouzdano');
    expect(() => reclamationParcelQuantity(shipment, { id: 'other', sku: 'chair', qty: 2 }, '9002838514')).toThrow('pouzdano');
    expect(() => reclamationParcelQuantity(shipment, { id: 'i', sku: 'chair', qty: 2 }, '1234567')).toThrow('pripada');
  });
  it('accepts a scanner control digit only with provider evidence', () => {
    expect(canonicalReturnParcel(shipment, '090028385141')).toBeNull();
    expect(canonicalReturnParcel({ ...shipment, rawCreateResponse: { PrintLabelsInfoList: [{ ParcelNumber: 9002838514, ParcelNumberWithCheckdigit: 90028385141 }] } }, '090028385141')).toBe('9002838514');
  });
  it('receives the whole quantity for a single identified parcel', () => {
    expect(reclamationParcelQuantity({ ...shipment, packageCount: 1, providerParcelNumbers: [9002838514] }, { id: 'i', sku: 'chair', qty: 2 }, '9002838514')).toBe(2);
  });
});
