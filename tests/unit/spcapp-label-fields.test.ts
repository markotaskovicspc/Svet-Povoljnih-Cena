import { describe, expect, it } from 'vitest';
import { analyticsLabelFields } from '@/lib/partners/spcapp/label-fields';

describe('analyticsLabelFields', () => {
  it('exports barcode, origin, importer and product path like ERP labels', () => {
    const r = analyticsLabelFields({ sku: '200.111', name: 'Ugaona garnitura LUNA', slug: 'ugaona-garnitura-luna', barcode: ' 8605079400069 ', countryOfOrigin: 'Kina', declaration: null });
    expect(r.barcode).toBe('8605079400069');
    expect(r.importer).toBe('Evonek doo');
    expect(r.countryOfOrigin).toBeTruthy();
    expect(r.productPath).toBe('/p/ugaona-garnitura-luna');
  });
  it('uses the supplier country when the article has none', () => {
    const r = analyticsLabelFields({ sku: '100192', name: 'X', slug: 'x', barcode: null, countryOfOrigin: null, declaration: null, supplier: { country: 'CN' } });
    expect(r.countryOfOrigin).toBeTruthy();
  });
  it('keeps missing values empty', () => {
    const r = analyticsLabelFields({ sku: '100.1', name: 'X', slug: null, barcode: '  ', countryOfOrigin: null, declaration: null });
    expect(r).toMatchObject({ barcode: null, countryOfOrigin: null, productPath: null });
  });
});
