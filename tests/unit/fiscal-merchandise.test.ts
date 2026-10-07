import {expect,it} from 'vitest';
import {ananasMerchandiseItems,fiscalMerchandiseAmounts,isFiscalService} from '../../src/lib/admin/fiscal-merchandise';
it('excludes services without dropping furniture mentioning assembly elsewhere',()=>{
 expect(ananasMerchandiseItems([{sku:'A',name:'Sto za montažu',quantity:2,gross:2000},{sku:'DOSTAVA',name:'Usluga',quantity:1,gross:399},{sku:'S',name:'Montaža nameštaja',quantity:1,gross:100}])).toEqual([{sku:'A',name:'Sto za montažu',quantity:2,gross:2000}]);
 expect(isFiscalService('110087','Stolica')).toBe(false);
});
it('removes allocated service values from merchandise gross and net',()=>{
 expect(fiscalMerchandiseAmounts({qty:2,totalGross:2799,totalNet:2332.5,serviceGross:399,vatRate:20})).toEqual({gross:2400,net:2000,unit:1200});
});
it('keeps document item quantities and actual item net, without inventing missing net',()=>{
 expect(ananasMerchandiseItems([{sku:'A',name:'Sto',quantity:2,gross:2000,net:1666.67},{sku:'B',name:'Stolica',quantity:1,gross:1000}])).toHaveLength(2);
 expect(ananasMerchandiseItems([{sku:'A',name:'Sto',quantity:2,gross:2000}])[0]).not.toHaveProperty('net');
});
