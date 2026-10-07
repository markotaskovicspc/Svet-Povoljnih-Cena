import { dateInputInTimeZone } from './report-period';
import { ananasMerchandiseItems, isFiscalService } from './fiscal-merchandise';

export const FINANCE_METRICS = ['proformaCount','proformaGross','fiscalSaleCount','fiscalSaleGross','fiscalRefundCount','fiscalRefundGross','fiscalNetGross','fiscalSaleCogs','fiscalRefundCogs','fiscalNetCogs','spcNetGross','ananasNetGross','spcNetCogs','ananasNetCogs','estimatedCogsQty','missingCogsQty'] as const;
export type DailyFinanceReportRow = {day:string} & Record<typeof FINANCE_METRICS[number],number>;
export type FinanceChannel = 'ALL'|'SPC'|'ANANAS';
export function financeChannel(value:unknown):FinanceChannel {return value==='SPC'||value==='ANANAS'?value:'ALL';}
export function emptyFinanceTotals(){return Object.fromEntries(FINANCE_METRICS.map(key=>[key,0])) as Omit<DailyFinanceReportRow,'day'>;}
export function summarizeDailyFinanceReport(rows:readonly DailyFinanceReportRow[]){
 const total=emptyFinanceTotals();for(const row of rows)for(const key of FINANCE_METRICS)total[key]=Math.round((total[key]+row[key])*100)/100;return total;
}
type CostLine={issuedAt:Date,kind:string,sku:string,name:string,qty:number,unitCogs:number|null,originalUnitCogs?:number|null,currentCogs:number|null};
type AnanasDoc={issuedAt:Date,kind:string,gross:number,items:unknown};
type BaseRow=Pick<DailyFinanceReportRow,'day'|'proformaCount'|'proformaGross'|'fiscalSaleCount'|'fiscalSaleGross'|'fiscalRefundCount'|'fiscalRefundGross'|'fiscalNetGross'>;
export function combineDailyFinance(base:readonly BaseRow[],lines:readonly CostLine[],documents:readonly AnanasDoc[],costs:ReadonlyMap<string,number|null>,channel:FinanceChannel='ALL'):DailyFinanceReportRow[]{
 const rows=new Map(base.map(row=>[row.day,{...emptyFinanceTotals(),...row,spcNetGross:row.fiscalNetGross}]));
 const cost=(row:DailyFinanceReportRow,kind:string,qty:number,snapshot:number|null,current:number|null,source:'SPC'|'ANANAS')=>{
  const unit=snapshot??current;const refund=kind==='REFUND',sign=refund?-1:1;
  if(unit==null){row.missingCogsQty+=qty;return;}
  if(snapshot==null)row.estimatedCogsQty+=qty;
  const amount=Math.round(unit*qty*100)/100;
  row[refund?'fiscalRefundCogs':'fiscalSaleCogs']+=amount;row.fiscalNetCogs+=sign*amount;row[source==='SPC'?'spcNetCogs':'ananasNetCogs']+=sign*amount;
 };
 if(channel!=='ANANAS')for(const line of lines){const row=rows.get(dateInputInTimeZone(line.issuedAt));if(row&&!isFiscalService(line.sku,line.name))cost(row,line.kind,line.qty,line.unitCogs??(line.kind==='REFUND'?line.originalUnitCogs??null:null),line.currentCogs,'SPC');}
 if(channel==='ANANAS')for(const row of rows.values()){row.proformaCount=0;row.proformaGross=0;row.fiscalSaleCount=0;row.fiscalSaleGross=0;row.fiscalRefundCount=0;row.fiscalRefundGross=0;row.fiscalNetGross=0;row.spcNetGross=0;}
 if(channel!=='SPC')for(const doc of documents){const row=rows.get(dateInputInTimeZone(doc.issuedAt));if(!row)continue;const refund=doc.kind==='REFUND',sign=refund?-1:1;
  row[refund?'fiscalRefundCount':'fiscalSaleCount']++;row[refund?'fiscalRefundGross':'fiscalSaleGross']+=doc.gross;row.fiscalNetGross+=sign*doc.gross;row.ananasNetGross+=sign*doc.gross;
  for(const item of ananasMerchandiseItems(doc.items))cost(row,doc.kind,item.quantity,null,costs.get(item.sku)??null,'ANANAS');
 }
 return [...rows.values()].map(row=>{for(const key of FINANCE_METRICS)row[key]=Math.round(row[key]*100)/100;return row;});
}
