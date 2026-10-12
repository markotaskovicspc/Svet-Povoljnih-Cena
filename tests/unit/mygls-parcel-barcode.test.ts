import { describe, expect, it } from 'vitest';
import { myGlsBarcodeParcelNumber } from '@/lib/mygls/parcel-barcode';
import { canonicalReturnParcel } from '@/lib/admin/return-receipt-plan';

describe('GLS scanned label control digit', () => {
  it.each([
    ['090028529507', '9002852950'],
    ['090028529538', '9002852953'],
    ['90028529507', '9002852950'],
    ['641012345674', '64101234567'],
  ])('validates %s and returns its parcel number', (barcode, expected) => {
    expect(myGlsBarcodeParcelNumber(barcode)).toBe(expected);
  });
  it.each(['090028529506', '090028529539', '0900285295079', 'AAA090028529507', '9002852950'])('rejects malformed or incorrect %s', barcode => {
    expect(myGlsBarcodeParcelNumber(barcode)).toBeNull();
  });
  it('maps each warehouse scan to its own saved package without needing an API alias', () => {
    const shipment = { id: 's', provider: 'MYGLS', providerParcelNumbers: [9002852950, 9002852951, 9002852952, 9002852953] };
    expect(canonicalReturnParcel(shipment, '090028529507')).toBe('9002852950');
    expect(canonicalReturnParcel(shipment, '090028529538')).toBe('9002852953');
    expect(canonicalReturnParcel({ ...shipment, providerParcelNumbers: [9002852951] }, '090028529507')).toBeNull();
  });
});
