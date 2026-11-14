import 'server-only';
import {db} from '@/lib/db';
import {loadOrderForEmail} from './adapt';
import {trackedDispatch} from './tracking';
import type {BankEntry,BankUnmatched} from '@/lib/payments/bank-statements';
import type {PaymentConfirmation} from '@/lib/payments/payment-confirmation';
import {getEmailConfig} from './config';
import {orderLinkForEmail} from './order-link';
import {renderEmail} from './render';
import {BankPaymentConfirmation} from './templates/bank-payment-confirmation';

// Marko, 14.11.2026: the payment confirmation goes only to the customer; every
// bank review notice goes to office@ instead of podrska@.
const OFFICE='office@svetpovoljnihcena.rs';
const money=(amount:number,currency='RSD')=>new Intl.NumberFormat('sr-Latn-RS',{minimumFractionDigits:2,maximumFractionDigits:2}).format(amount/100)+(currency==='RSD'?' din':` ${currency}`);
const html=(text:string)=>'<div style="font-family:Arial,sans-serif;white-space:pre-line">'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</div>';
export async function sendBankPaymentConfirmation(entry:PaymentConfirmation){
 const loaded=await loadOrderForEmail(entry.orderId);
 if(!loaded)throw Error('BANK_EMAIL_ORDER_NOT_FOUND');
 if(!loaded.recipient)return {skipped:'NO_CUSTOMER_EMAIL' as const};
 const manual='source' in entry;
 if(manual){
  // A queued snapshot may have been corrected or marked unpaid before the
  // worker runs. Only acknowledge the exact receipt that is still paid now.
  const payment=await db.payment.findUnique({where:{id:entry.paymentId},select:{
   orderId:true,status:true,method:true,provider:true,amount:true,currency:true,
  }});
  if(!payment||payment.orderId!==entry.orderId||payment.status!=='PAID'||
   payment.method!=='UPLATA_NA_RACUN'||payment.provider!=='MANUAL'||
   payment.currency!==entry.currency||!payment.amount.mul(100).equals(entry.amountMinor)){
   return {skipped:'PAYMENT_CHANGED' as const};
  }
 }
 const orderUrl=await orderLinkForEmail(entry.orderId,loaded.order,getEmailConfig().baseUrl);
 const rendered=await renderEmail(BankPaymentConfirmation({orderNumber:entry.orderNumber,amountMinor:entry.amountMinor,currency:entry.currency,firstName:loaded.order.shippingAddress?.firstName,orderUrl}));
 const text=[rendered.text,orderUrl?`Pregled porudžbine: ${orderUrl}`:null].filter(Boolean).join('\n\n');
 return trackedDispatch({kind:'bank_payment_confirmation',to:loaded.recipient,subject:`Uplata evidentirana — ${entry.orderNumber}`,text,html:rendered.html,idempotencyKey:manual?`bank-payment:manual:${entry.paymentId}`:`bank-payment:${entry.account}:${entry.bankReference}`,tags:{kind:'bank_payment_confirmation',order:entry.orderNumber},metadata:manual?{source:'MANUAL',paymentId:entry.paymentId}:{bankReference:entry.bankReference,statement:entry.statement}});
}
const REASONS:Record<string,string>={
 ORDER_NOT_FOUND:'Porudžbina sa tim brojem nije pronađena.',
 PAYMENT_METHOD_MISMATCH:'Porudžbina ima drugi način plaćanja, a ne uplatu na račun.',
 ORDER_CANCELLED_OR_RETURNED:'Porudžbina je otkazana ili vraćena; ne sme se automatski ponovo aktivirati.',
 PAYMENT_ALREADY_RECORDED:'Porudžbina već ima evidentirano plaćanje ili povraćaj. Proverite da li je u pitanju dodatna uplata.',
 AMOUNT_MISMATCH:'Uplaćeni iznos se razlikuje od ukupnog iznosa porudžbine.',
 BANK_REFERENCE_CONFLICT:'Ista bankarska referenca je već vezana za druge podatke.',
};
export async function sendBankPaymentReview(entry:BankEntry&{reason:string}){
 const text=`Potrebna je provera bankarske uplate.\n\nPorudžbina: ${entry.orderNumber}\nUplata: ${money(entry.amountMinor)}\nIzvod: ${entry.statement}, ${entry.date}\nReferenca banke: ${entry.bankReference}\n\nRazlog: ${REASONS[entry.reason]??entry.reason}\n\nPlaćanje nije automatski evidentirano i kupcu nije poslata potvrda. Otvorite porudžbinu u ERP-u i uporedite podatke sa bankarskim izvodom.`;
 return trackedDispatch({kind:'bank_payment_review',to:OFFICE,subject:`Provera uplate — ${entry.orderNumber}`,text,html:html(text),idempotencyKey:`bank-review:${entry.account}:${entry.bankReference}`,tags:{kind:'bank_payment_review',order:entry.orderNumber}});
}
export async function sendBankStatementReview(input:{sourceHash:string;reason:string}){
 const reasons:Record<string,string>={BANK_SENDER_NOT_VERIFIED:'Autentičnost poruke banke nije potvrđena DKIM potpisom.',BANK_CREDIT_TOTAL_MISMATCH:'Zbir pročitanih priliva se ne poklapa sa ukupnim prilivom na izvodu.',BANK_REFERENCE_AMBIGUOUS:'Nije moguće pouzdano povezati broj porudžbine, referencu banke i iznos.',BANK_STATEMENT_WRONG_ACCOUNT:'Prilog nema očekivani račun firme, PIB, valutu ili zaglavlje banke.',BANK_ATTACHMENTS_INVALID:'Poruka nema podržan PDF prilog ili ih ima previše.',BANK_PDF_INVALID:'Prilog nije podržan PDF ili prelazi dozvoljenu veličinu.'};
 const text=`Bankarski izvod nije automatski obrađen.\n\nRazlog provere: ${reasons[input.reason]??'Format bankarskog priloga nije pouzdano pročitan.'}\nKod: ${input.reason}\n\nOtvorite poslednji mejl banke u sandučetu podrške i proverite PDF prilog. Nijedna uplata iz ovog priloga nije automatski evidentirana.\nIdentifikator: ${input.sourceHash.slice(0,12)}`;
 return trackedDispatch({kind:'bank_statement_review',to:OFFICE,subject:'Bankarski izvod — potrebna provera',text,html:html(text),idempotencyKey:`bank-statement-review:${input.sourceHash}`});
}
const UNMATCHED:Record<BankUnmatched['reason'],string>={
 SPC_UNREADABLE:'U pozivu na broj ili svrsi piše SPC, ali broj porudžbine nije čitljiv.',
 SPC_NOT_IN_REFERENCE:'Broj porudžbine nije u pozivu na broj, već na drugom mestu u uplati (npr. svrha).',
 SPC_MISSING:'Uplata nema broj porudžbine.',
};
const dateSr=(d:Date)=>d.toLocaleDateString('sr-Latn-RS',{timeZone:'Europe/Belgrade'});
export async function sendBankUnmatchedReview(entry:BankUnmatched){
 const {bankUnmatchedSuggestions}=await import('@/lib/payments/bank-statements.server');
 const {candidates,suggested}=await bankUnmatchedSuggestions(entry);
 // Other credits without any SPC mention (courier payouts, card settlements…) are only
 // reported when an unpaid bank-transfer order has exactly the same total.
 if(entry.reason==='SPC_MISSING'&&!candidates.length)return {skipped:'NO_CANDIDATES' as const};
 const lines=[
  'Uplata na račun nije automatski povezana sa porudžbinom.','',
  `Uplata: ${money(entry.amountMinor)}`,`Izvod: ${entry.statement}, ${entry.date}`,`Referenca banke: ${entry.bankReference}`,'',
  `Razlog: ${UNMATCHED[entry.reason]}`,
 ];
 if(entry.suggestedOrderNumber)lines.push(`Broj pronađen u uplati: ${entry.suggestedOrderNumber} — ${suggested==='MATCHED'?'iznos i način plaćanja se poklapaju.':REASONS[suggested??'']??suggested}`);
 lines.push('',candidates.length
  ?`Neplaćene porudžbine sa uplatom na račun i istim iznosom (poslednjih 60 dana):\n${candidates.slice(0,5).map(c=>`- ${c.number} (kreirana ${dateSr(c.createdAt)})`).join('\n')}${candidates.length>5?'\n- … i još porudžbina sa istim iznosom':''}`
  :'Nema neplaćene porudžbine sa uplatom na račun i istim iznosom u poslednjih 60 dana.');
 lines.push('','Ovo je samo predlog. Plaćanje nije evidentirano i kupcu nije poslata potvrda. Uporedite uplatioca na izvodu sa porudžbinom i potvrdite uplatu ručno u ERP-u.');
 const text=lines.join('\n');
 return trackedDispatch({kind:'bank_unmatched_review',to:OFFICE,subject:`Uplata bez broja porudžbine — ${money(entry.amountMinor)}`,text,html:html(text),idempotencyKey:`bank-unmatched-review:${entry.account}:${entry.bankReference}`,tags:{kind:'bank_unmatched_review'}});
}
