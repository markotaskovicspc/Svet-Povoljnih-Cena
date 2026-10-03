import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {parseErsteStatement,rsdMinor,isBankMail,verifyBankMail} from '../src/bank-statements.mjs';

async function pdf({account='340000100028300451',total='3.652,00',debit=false,second=false}={}){
 const doc=await PDFDocument.create(),page=doc.addPage([842,595]),font=await doc.embedFont(StandardFonts.Helvetica);
 const draw=(text,x,y)=>page.drawText(text,{x,y,font,size:9});
 draw(`Erste Bank 115085587 ${account} 941 RSD`,20,570);
 draw('Izvod broj i datum: 225/30.09.2026.',20,550);
 draw(`Ukupno u korist ${total} RSD`,20,530);
 const row=(n,y,amount,x,order,reference)=>{draw(String(n),23,y);draw('30.09.2026.',73,y);draw('30.09.2026.',133,y);draw('PBO: 00 '+order,544,y+8);draw(reference,544,y-8);draw(amount,x,y);};
 row(1,400,'3.652,00',debit?664:744,'SPC-2026-001139','FT26273LJRRX');
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
test('money conversion is exact and malformed separators are rejected',()=>{
 assert.equal(rsdMinor('1.000.000,01'),100000001);assert.throws(()=>rsdMinor('1,000.00'));assert.throws(()=>rsdMinor('3.65,20'));
});
test('exact bank sender plus verified aligned full-body DKIM is required',async()=>{
 const env={BANK_STATEMENT_SENDERS:'statements@bank.example'},mail={from:{value:[{address:'statements@bank.example'}]}};
 assert(isBankMail(mail,env));assert(!isBankMail(mail,{}));assert(!isBankMail({from:{value:[{address:'statements@bank.example.evil'}]}},env));
 for(const entry of [{signingDomain:'evil.example',status:{result:'pass'}},{signingDomain:'bank.example',status:{result:'fail'}},{signingDomain:'bank.example',status:{result:'pass'},canonBodyLengthLimited:true}])assert.equal(await verifyBankMail(Buffer.from('x'),mail,env,async()=>({results:[entry]})),false);
 assert.equal(await verifyBankMail(Buffer.from('x'),mail,env,async()=>({results:[{signingDomain:'bank.example',status:{result:'pass'}}]})),true);
 assert.equal(await verifyBankMail(Buffer.from('From: statements@bank.example\r\nAuthentication-Results: fake; dkim=pass\r\n\r\nforged'),mail,env),false);
});
