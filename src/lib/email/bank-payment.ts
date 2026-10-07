import 'server-only';
import {loadOrderForEmail} from './adapt';
import {trackedDispatch} from './tracking';
import type {BankEntry} from '@/lib/payments/bank-statements';

const SUPPORT='podrska@svetpovoljnihcena.rs';
const money=(amount:number)=>new Intl.NumberFormat('sr-Latn-RS',{minimumFractionDigits:2,maximumFractionDigits:2}).format(amount/100)+' din';
const html=(text:string)=>'<div style="font-family:Arial,sans-serif;white-space:pre-line">'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</div>';
export async function sendBankPaymentConfirmation(entry:BankEntry&{orderId:string}){
 const loaded=await loadOrderForEmail(entry.orderId);
 if(!loaded)throw Error('BANK_EMAIL_ORDER_NOT_FOUND');
 const text=`Poštovani,\n\nVaša uplata od ${money(entry.amountMinor)} za porudžbinu ${entry.orderNumber} uspešno je evidentirana.\n\nHvala na kupovini!\nKorisnička podrška | Svet Povoljnih Cena`;
 return trackedDispatch({kind:'bank_payment_confirmation',to:loaded.recipient||SUPPORT,bcc:loaded.recipient?[SUPPORT]:undefined,subject:`Uplata evidentirana — ${entry.orderNumber}`,text,html:html(text),idempotencyKey:`bank-payment:${entry.account}:${entry.bankReference}`,tags:{kind:'bank_payment_confirmation',order:entry.orderNumber},metadata:{bankReference:entry.bankReference,statement:entry.statement}});
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
 return trackedDispatch({kind:'bank_payment_review',to:SUPPORT,subject:`Provera uplate — ${entry.orderNumber}`,text,html:html(text),idempotencyKey:`bank-review:${entry.account}:${entry.bankReference}`,tags:{kind:'bank_payment_review',order:entry.orderNumber}});
}
export async function sendBankStatementReview(input:{sourceHash:string;reason:string}){
 const reasons:Record<string,string>={BANK_SENDER_NOT_VERIFIED:'Autentičnost poruke banke nije potvrđena DKIM potpisom.',BANK_CREDIT_TOTAL_MISMATCH:'Zbir pročitanih priliva se ne poklapa sa ukupnim prilivom na izvodu.',BANK_REFERENCE_AMBIGUOUS:'Nije moguće pouzdano povezati broj porudžbine, referencu banke i iznos.',BANK_STATEMENT_WRONG_ACCOUNT:'Prilog nema očekivani račun firme, PIB, valutu ili zaglavlje banke.',BANK_ATTACHMENTS_INVALID:'Poruka nema podržan PDF prilog ili ih ima previše.',BANK_PDF_INVALID:'Prilog nije podržan PDF ili prelazi dozvoljenu veličinu.'};
 const text=`Bankarski izvod nije automatski obrađen.\n\nRazlog provere: ${reasons[input.reason]??'Format bankarskog priloga nije pouzdano pročitan.'}\nKod: ${input.reason}\n\nOtvorite poslednji mejl banke u sandučetu podrške i proverite PDF prilog. Nijedna uplata iz ovog priloga nije automatski evidentirana.\nIdentifikator: ${input.sourceHash.slice(0,12)}`;
 return trackedDispatch({kind:'bank_statement_review',to:SUPPORT,subject:'Bankarski izvod — potrebna provera',text,html:html(text),idempotencyKey:`bank-statement-review:${input.sourceHash}`});
}
