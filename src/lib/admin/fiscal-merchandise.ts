import { z } from "zod";

const itemSchema = z.object({sku:z.string(),name:z.string(),quantity:z.number().positive(),gross:z.number().nonnegative(),net:z.number().nonnegative().optional()});
const serviceSku = /^(?:DOSTAVA|POSTARINA|SHIPPING|DELIVERY|MONTAZA|ASSEMBLY)(?:$|[-_\s])/;
export function isFiscalService(sku:string,name:string) {
  const fold=(text:string)=>text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
  return serviceSku.test(fold(sku)) || /^(?:DOSTAVA|POSTARINA|TROSKOVI DOSTAVE|SHIPPING|DELIVERY|MONTAZA|ASSEMBLY)(?:$|\s)/.test(fold(name));
}
export function ananasMerchandiseItems(items:unknown) {
  if(!Array.isArray(items))return [];
  return items.flatMap(value=>{const parsed=itemSchema.safeParse(value);return parsed.success&&!isFiscalService(parsed.data.sku,parsed.data.name)?[parsed.data]:[];});
}
// serviceGross includes allocated services inside a merchandise fiscal line.
export function fiscalMerchandiseAmounts(line:{qty:number,totalGross:number,totalNet:number,serviceGross:number,vatRate:number}) {
  const round=(n:number)=>Math.round(n*100)/100;
  const gross=round(line.totalGross-line.serviceGross);
  const net=round(line.totalNet-line.serviceGross/(1+line.vatRate/100));
  return {gross,net,unit:line.qty?round(gross/line.qty):0};
}
