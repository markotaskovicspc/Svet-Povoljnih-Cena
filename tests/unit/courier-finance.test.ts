import { expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
vi.mock("@/lib/db", () => ({ db: {} }));
import { courierBaseCost, statementAmounts, matchStatementRow, codBalance, type StatementRow } from "@/lib/courier/finance";
import { parseStatementFile } from "@/lib/courier/statement-file";
import { statementIdentity } from "@/lib/courier/finance.server";
const row: StatementRow = { kind: "COST", trackingNo: "900001", bookedOn: "2026-09-30", amount: 240, vatIncluded: false };
it("applies signed tariff boundaries and charges one COD fee", () => {
 expect(courierBaseCost("MYGLS",1.99)).toBe(260);
 expect(courierBaseCost("MYGLS",2)).toBe(290);
 expect(courierBaseCost("MYGLS",24.8,2,true)).toBe(600);
 expect(courierBaseCost("MYGLS",40)).toBeNull();
 expect(courierBaseCost("X_EXPRESS",5,1,true)).toBe(290);
 expect(courierBaseCost("X_EXPRESS",5.01)).toBe(300);
 expect(courierBaseCost("X_EXPRESS",51)).toBe(840.5);
});
it("keeps remittances outside VAT and detects shortages/excess", () => {
 expect(statementAmounts(row)).toEqual({net:240,gross:288});
 expect(statementAmounts({...row,amount:288,vatIncluded:true})).toEqual({net:240,gross:288});
 expect(statementAmounts({...row,kind:"COD",amount:1000})).toEqual({net:1000,gross:1000});
 expect(codBalance(1000,600).status).toBe("SHORT"); expect(codBalance(null,600).status).toBe("UNKNOWN");
 expect(codBalance(1000,1001).status).toBe("EXCESS");
});
it("matches parcel identity and rejects an order mismatch or ambiguous identities", () => {
 const shipments=[{id:"s1",trackingNo:"other",parcelNumbers:[900001],orderNumber:"SPC-1"}];
 expect(matchStatementRow(row,shipments).shipmentId).toBe("s1");
 expect(matchStatementRow({...row,orderNumber:"SPC-2"},shipments).status).toBe("UNMATCHED");
 expect(matchStatementRow(row,[...shipments,{...shipments[0],id:"s2"}]).status).toBe("AMBIGUOUS");
});
it("matches known replacement references only with the exact parcel and original order", () => {
 const shipments=[{id:"replacement",trackingNo:"9002766486",parcelNumbers:null,orderNumber:"SPC-2026-000636"}];
 for (const suffix of ["ZAMENA", "R2-PRS", "POVRAT", "POVRAT-Rabcdef123456"]) {
   expect(matchStatementRow({...row,trackingNo:"9002766486",orderNumber:`SPC-2026-000636-${suffix}`},shipments).shipmentId).toBe("replacement");
 }
 expect(matchStatementRow({...row,trackingNo:"wrong",orderNumber:"SPC-2026-000636-ZAMENA"},shipments).status).toBe("UNMATCHED");
 expect(matchStatementRow({...row,trackingNo:"9002766486",orderNumber:"SPC-2026-000669-ZAMENA"},shipments).status).toBe("UNMATCHED");
 expect(matchStatementRow({...row,trackingNo:"9002766486",orderNumber:"SPC-2026-000636-UNKNOWN"},shipments).status).toBe("UNMATCHED");
 expect(matchStatementRow({...row,trackingNo:"9002766486",orderNumber:"SPC-2026-000636-ZAMENA"},[...shipments,{...shipments[0],id:"duplicate"}]).status).toBe("AMBIGUOUS");
});
it("matches X Express invoice codes saved by carrier webhooks without guessing from recipient names", () => {
 const shipments=[{id:"x1",trackingNo:"AAA0850301369",invoiceCode:"26-0001261319",parcelNumbers:null,orderNumber:"SPC-2026-001068"}];
 expect(matchStatementRow({...row,trackingNo:"26-0001261319"},shipments).shipmentId).toBe("x1");
 expect(matchStatementRow({...row,trackingNo:"26-0001261320"},shipments).status).toBe("UNMATCHED");
});
it("fingerprints reordered duplicate uploads independently of file/document name",()=>{
 const a={provider:"MYGLS" as const,documentNo:"a",filename:"a.xlsx",rows:[row,{...row,trackingNo:"900002"}]};
 expect(statementIdentity(a).fingerprint).toBe(statementIdentity({...a,documentNo:"b",filename:"b.xlsx",rows:[...a.rows].reverse()}).fingerprint);
 expect(()=>statementIdentity({...a,rows:[row,row]})).toThrow(/duplirane/);
});
it("reads namespaced GLS billing exports and does not double-count the breakdown sheet",async()=>{
 const w=new ExcelJS.Workbook();const s=w.addWorksheet("Delivery Details");
 s.addRow(["Broj pošiljke / Parcel number","Referenca klijenta / Client reference","Referenca pouzeća / COD Reference","Težina/Veličina / Weight / Size","Naknada za transport / Transport fee","Naknada za gorivo / Diesel fee","Ukupna naknada za uslugu/Ukupna naknada za usluge / Total service fees","Total doplatne naknade / Total surcharges fee","Ukupan iznos / Total amount","Valuta / Currency"]);
 s.addRow(["900001","SPC-1-P1","SPC-1",24.8,610,44,70,400,1124,"RSD"]);
 w.addWorksheet("Services Surcharges details").addRow(["breakdown",400]);
 const zip=await JSZip.loadAsync(await w.xlsx.writeBuffer());
 for(const e of Object.values(zip.files)){if(!e.name.endsWith(".xml"))continue;let xml=await e.async("string");if(!xml.includes('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'))continue;xml=xml.replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"','xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"').replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s>/])/g,"<$1x:$2");zip.file(e.name,xml);}
 const rows=await parseStatementFile(await zip.generateAsync({type:"nodebuffer"}),"gls.xlsx","MYGLS","2026-09-30");
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({kind:"COST",amount:1124,vatIncluded:false,orderNumber:"SPC-1",bookedOn:"2026-09-30"});
});
it("rejects invalid dates, currency and PDF input",async()=>{
 await expect(parseStatementFile(Buffer.from("pdf"),"a.pdf","MYGLS","2026-09-30")).rejects.toThrow(/XLSX/);
 const csv="tip;broj_posiljke;porudzbina;datum;tezina_kg;iznos_rsd;pdv_ukljucen;opis\nCOST;900001;;2026-02-30;1;100;ne;\n";
 await expect(parseStatementFile(Buffer.from(csv),"a.csv","MYGLS","2026-09-30")).rejects.toThrow(/datum/);
});
