import { expect, it } from 'vitest';
import { courierPaymentCoverage } from '@/lib/courier/finance-coverage';
it('does not report a shortage or zero remittance without imported evidence', () => {
 expect(courierPaymentCoverage(1998, [])).toEqual({cod:null,codStatus:'NO_STATEMENT'});
 expect(courierPaymentCoverage(null, [])).toEqual({cod:null,codStatus:'NO_STATEMENT'});
});
it('distinguishes returned/prepaid shipments from reconciled payments', () => {
 expect(courierPaymentCoverage(0, [])).toEqual({cod:0,codStatus:'NOT_REQUIRED'});
 expect(courierPaymentCoverage(0, [500])).toEqual({cod:500,codStatus:'EXCESS'});
});
it('still detects an explicit zero, partial, exact and excess payment', () => {
 expect(courierPaymentCoverage(1000,[0]).codStatus).toBe('SHORT');
 expect(courierPaymentCoverage(1000,[400]).codStatus).toBe('SHORT');
 expect(courierPaymentCoverage(1000,[400,600])).toEqual({cod:1000,codStatus:'SETTLED'});
 expect(courierPaymentCoverage(1000,[1001]).codStatus).toBe('EXCESS');
 expect(courierPaymentCoverage(null,[1000]).codStatus).toBe('UNKNOWN');
});
