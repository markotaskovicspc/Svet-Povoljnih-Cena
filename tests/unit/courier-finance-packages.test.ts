import {expect,it} from 'vitest';
import {courierFinancePackages} from '@/lib/courier/finance-packages';
const shipment={id:'s',provider:'MYGLS',trackingNo:'123',providerParcelNumbers:[123,124,125],packageCount:3,
 rawCreateResponse:{myGlsPackageAssignments:[{parcelNumber:123,codAmount:3567},{parcelNumber:124,codAmount:0},{parcelNumber:125,codAmount:0}]},
 pickupBatchLines:[{providerParcelNumber:'125',weightKg:7},{providerParcelNumber:'123',weightKg:1},{providerParcelNumber:'124',weightKg:1}]};
it('matches saved weights by parcel identity despite different row ordering',()=>{
 expect(courierFinancePackages(shipment)).toEqual([{weightKg:1,codAmount:3567},{weightKg:1,codAmount:0},{weightKg:7,codAmount:0}]);
});
it('refuses incomplete, duplicate or unknown historical weights',()=>{
 expect(courierFinancePackages({...shipment,pickupBatchLines:shipment.pickupBatchLines.slice(1)})).toEqual([]);
 expect(courierFinancePackages({...shipment,pickupBatchLines:[...shipment.pickupBatchLines,shipment.pickupBatchLines[0]]})).toEqual([]);
 expect(courierFinancePackages({...shipment,pickupBatchLines:shipment.pickupBatchLines.map(l=>({...l,weightKg:null}))})).toEqual([]);
 expect(courierFinancePackages({...shipment,rawCreateResponse:{}})).toEqual([]);
});
