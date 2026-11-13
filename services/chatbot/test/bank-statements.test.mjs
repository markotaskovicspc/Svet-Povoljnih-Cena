import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {parseErsteStatement,rsdMinor,isBankMail,verifyBankMail,orderNumbers} from '../src/bank-statements.mjs';

async function pdf({account='340000100028300451',total='3.652,00',debit=false,second=false,order='SPC-2026-001139',pbz,reference='FT26273LJRRX'}={}){
 const doc=await PDFDocument.create(),page=doc.addPage([842,595]),font=await doc.embedFont(StandardFonts.Helvetica);
 const draw=(text,x,y)=>page.drawText(text,{x,y,font,size:9});
 draw(`Erste Bank 115085587 ${account} 941 RSD`,20,570);
 draw('Izvod broj i datum: 225/30.09.2026.',20,550);
 draw(`Ukupno u korist ${total} RSD`,20,530);
 const row=(n,y,amount,x,order,reference)=>{draw(String(n),23,y);draw('30.09.2026.',73,y);draw('30.09.2026.',133,y);draw('PBO: 00 '+order,544,y+8);draw(reference,544,y-8);draw(amount,x,y);};
 row(1,400,'3.652,00',debit?664:744,order,reference);
 if(pbz!==undefined)draw('PBZ: 00 '+pbz,544,400);
 if(second)row(2,350,'5.000,00',664,'SPC-2026-001140','FT26273OTHER');
 return Buffer.from(await doc.save());
}
test('reads only incoming SPC credit and ignores outgoing SPC payment',async()=>{
 const result=await parseErsteStatement(await pdf({second:true}));assert.equal(result.entries.length,1);assert.equal(result.entries[0].amountMinor,365200);assert.equal(result.entries[0].bankReference,'FT26273LJRRX');assert.equal(result.entries[0].orderNumber,'SPC-2026-001139');
});
test('wrong merchant account and a broken credit total cannot be applied',async()=>{
 await assert.rejects(()=>parseErsteStatement(Buffer.from('not pdf')),/BANK_PDF_INVALID/);
 await assert.rejects(()=>pdf({account:'340000999999999999'}).then(parseErsteStatement),/WRONG_ACCOUNT/);
 await assert.rejects(()=>pdf({total:'4.652,00'}).then(parseErsteStatement),/TOTAL_MISMATCH/);
 await assert.rejects(()=>pdf({debit:true}).then(parseErsteStatement),/TOTAL_MISMATCH/);
});
test('identical PBO/PBZ values identify one order, including the compact reference',async()=>{
 for(const order of ['SPC-2026-001139','SPC2026001139']){
  const result=await parseErsteStatement(await pdf({order,pbz:'SPC-2026-001139'}));
  assert.equal(result.entries.length,1);assert.equal(result.entries[0].orderNumber,'SPC-2026-001139');
 }
});
test('conflicting orders, PBZ-only orders and multiple bank references still fail closed',async()=>{
 await assert.rejects(()=>pdf({pbz:'SPC-2026-001140'}).then(parseErsteStatement),/BANK_REFERENCE_AMBIGUOUS/);
 await assert.rejects(()=>pdf({order:'OTHER',pbz:'SPC-2026-001139'}).then(parseErsteStatement),/BANK_REFERENCE_AMBIGUOUS/);
 await assert.rejects(()=>pdf({reference:'FT26273LJRRX FT26273OTHER'}).then(parseErsteStatement),/BANK_REFERENCE_AMBIGUOUS/);
 const result=await parseErsteStatement(await pdf({order:'SPC20260011399'}));assert.deepEqual(result.entries,[]);
 assert.deepEqual(result.unmatched.map(x=>x.reason),['SPC_UNREADABLE']);
});
test('two-page statement with repeated references and compact PBO preserves all credit rows',async()=>{
 // Reproduce statement 231 layout without retaining customer names/accounts or the private PDF.
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
 const page=doc.addPage([842,595]),next=doc.addPage([842,595]);
 const draw=(p,text,x,y)=>p.drawText(text,{x,y,font,size:9});
 draw(page,'Erste Bank 115085587 340000100028300451 941 RSD',20,570);
 draw(page,'Izvod broj i datum: 231/06.10.2026.',20,550);
 draw(page,'Ukupno u korist 121.013,00 RSD',20,530);
 const row=(p,n,y,amount,order,reference,{debit=false,pbz}={})=>{
  draw(p,String(n),23,y);draw(p,'06.10.2026.',73,y);draw(p,'PBO: 00 '+order,544,y+8);
  draw(p,'PBZ: '+(pbz??''),544,y);draw(p,reference,544,y-8);draw(p,amount,debit?664:744,y);
 };
 row(page,1,450,'100.000,00','OTHER','FT26279J0K6X',{debit:true});
 row(page,2,400,'998,00','SPC-2026-001407','FT26279WSVS5');
 row(page,3,350,'3.185,00','SPC-2026-001409','FT26279SR4NC');
 row(page,4,300,'85.281,00','20261006','FT26279G79LR');
 row(page,5,250,'25.194,00','SPC-2026-001415','FT262798XKZK',{pbz:'00 SPC-2026-001415'});
 row(next,6,550,'6.355,00','SPC2026001370','FT26279H5LF0');
 const result=await parseErsteStatement(Buffer.from(await doc.save()));
 assert.equal(result.statement,'231');assert.equal(result.date,'2026-10-06');
 assert.deepEqual(result.entries.map(({orderNumber,amountMinor,bankReference})=>({orderNumber,amountMinor,bankReference})),[
  {orderNumber:'SPC-2026-001407',amountMinor:99800,bankReference:'FT26279WSVS5'},
  {orderNumber:'SPC-2026-001409',amountMinor:318500,bankReference:'FT26279SR4NC'},
  {orderNumber:'SPC-2026-001415',amountMinor:2519400,bankReference:'FT262798XKZK'},
  {orderNumber:'SPC-2026-001370',amountMinor:635500,bankReference:'FT26279H5LF0'},
 ]);
});
test('money conversion is exact and malformed separators are rejected',()=>{
 assert.equal(rsdMinor('1.000.000,01'),100000001);assert.throws(()=>rsdMinor('1,000.00'));assert.throws(()=>rsdMinor('3.65,20'));
});
test('exact bank sender plus verified aligned full-body DKIM is required',async()=>{
 const env={BANK_STATEMENT_SENDERS:'statements@bank.example'},mail={from:{value:[{address:'statements@bank.example'}]}};
 assert(isBankMail(mail,env));assert(!isBankMail(mail,{}));assert(!isBankMail({from:{value:[{address:'statements@bank.example.evil'}]}},env));
 for(const entry of [{signingDomain:'evil.example',status:{result:'pass'}},{signingDomain:'bank.example',status:{result:'fail'}},{signingDomain:'bank.example',status:{result:'pass'},canonBodyLengthLimited:true}])assert.equal(await verifyBankMail(Buffer.from('x'),mail,env,async()=>({results:[entry]})),false);
 assert.equal(await verifyBankMail(Buffer.from('x'),mail,env,async()=>({results:[{signingDomain:'bank.example',status:{result:'pass'}}]})),true);
 assert.equal(await verifyBankMail(Buffer.from('From: statements@bank.example\r\nAuthentication-Results: fake; dkim=pass\r\n\r\nforged'),mail,env),false);
 await assert.rejects(()=>verifyBankMail(Buffer.from('x'),mail,env,async()=>({results:[{status:{result:'temperror'}}]})),/BANK_VERIFICATION_UNAVAILABLE/);
});
test('loosely typed order numbers normalize to one canonical number',()=>{
 for(const text of ['SPC-2026-002340','SPC2026002340','spc-2026-002340','SPC2026-002340','SPC-2026002340','SPC 2026 002340','SPC/2026/002340','SPC.2026.2340','spc-2026-2340','SPC - 2026 - 2340'])assert.deepEqual(orderNumbers(text),['SPC-2026-002340'],text);
 assert.deepEqual(orderNumbers('SPC-2026-00234'),['SPC-2026-000234']);
 assert.deepEqual(orderNumbers('SPC20260011399'),[]);
 assert.deepEqual(orderNumbers('XSPC-2026-002340 SPC-1999-1 2026002340'),[]);
});
test('loose PBO number is applied as the canonical order',async()=>{
 for(const order of ['spc 2026 1139','SPC2026-001139','SPC-2026-1139']){
  const result=await parseErsteStatement(await pdf({order}));
  assert.equal(result.entries.length,1,order);assert.equal(result.entries[0].orderNumber,'SPC-2026-001139');assert.deepEqual(result.unmatched,[]);
 }
});
test('credits without a readable PBO order go to review, never to entries',async()=>{
 const unreadable=await parseErsteStatement(await pdf({order:'SPC-26-1139'}));
 assert.deepEqual(unreadable.entries,[]);
 assert.deepEqual(unreadable.unmatched,[{account:'340000100028300451',statement:'225',date:'2026-09-30',bankReference:'FT26273LJRRX',amountMinor:365200,currency:'RSD',reason:'SPC_UNREADABLE'}]);
 const missing=await parseErsteStatement(await pdf({order:'97 1234'}));
 assert.deepEqual(missing.unmatched.map(({reason,suggestedOrderNumber})=>({reason,suggestedOrderNumber})),[{reason:'SPC_MISSING',suggestedOrderNumber:undefined}]);
 // An order number outside PBO/PBZ (e.g. purpose) is only a suggestion for support.
 const doc=await PDFDocument.create(),page=doc.addPage([842,595]),font=await doc.embedFont(StandardFonts.Helvetica);
 const draw=(text,x,y)=>page.drawText(text,{x,y,font,size:9});
 draw('Erste Bank 115085587 340000100028300451 941 RSD',20,570);draw('Izvod broj i datum: 225/30.09.2026.',20,550);draw('Ukupno u korist 3.652,00 RSD',20,530);
 draw('1',23,400);draw('30.09.2026.',73,400);draw('Uplata po porudzbini spc 2026 1139',250,400);draw('PBO: 00',544,408);draw('FT26273LJRRX',544,392);draw('3.652,00',744,400);
 const purpose=await parseErsteStatement(Buffer.from(await doc.save()));
 assert.deepEqual(purpose.entries,[]);assert.equal(purpose.unmatched[0].reason,'SPC_NOT_IN_REFERENCE');assert.equal(purpose.unmatched[0].suggestedOrderNumber,'SPC-2026-001139');
});
