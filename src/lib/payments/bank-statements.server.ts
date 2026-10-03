import 'server-only';
import {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {enqueueBackgroundJob} from '@/lib/background-jobs';
import {bankEntryKey,bankPaymentDecision,type BankEntry} from './bank-statements';

export async function inspectBankEntry(entry:BankEntry){
 const order=await db.order.findUnique({where:{number:entry.orderNumber},include:{payments:{select:{status:true}}}});
 return {order,decision:bankPaymentDecision(order?{...order,totalMinor:Number(order.total.mul(100).toFixed(0))}:null,entry)};
}

export async function reconcileBankEntry(entry:BankEntry){
 return db.$transaction(async tx=>{
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${bankEntryKey(entry)},0))`);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Order" WHERE "number"=${entry.orderNumber} FOR UPDATE`);
  const order=await tx.order.findUnique({where:{number:entry.orderNumber},include:{payments:true,supplierFulfillments:{where:{supplier:{integrationKey:'RABALUX',enabled:true},status:{notIn:['CANCELLED','COMPLETED']}},select:{id:true}}}});
  const previouslyRecorded=await tx.payment.findFirst({where:{provider:'MANUAL',providerRef:entry.bankReference,rawResponse:{path:['bankAccount'],equals:entry.account}}});
  if(previouslyRecorded){
   if(previouslyRecorded.orderId===order?.id&&previouslyRecorded.amount.mul(100).equals(entry.amountMinor))return [];
   const job=await enqueueBackgroundJob({kind:'BANK_PAYMENT_REVIEW_EMAIL',payload:{...entry,reason:'BANK_REFERENCE_CONFLICT'},idempotencyKey:`bank-review:${entry.account}:${entry.bankReference}`},tx);return [job.id];
  }
  const decision=bankPaymentDecision(order?{...order,totalMinor:Number(order.total.mul(100).toFixed(0))}:null,entry);
  if(decision!=='MATCHED'||!order){
   const job=await enqueueBackgroundJob({kind:'BANK_PAYMENT_REVIEW_EMAIL',payload:{...entry,reason:decision},idempotencyKey:`bank-review:${entry.account}:${entry.bankReference}`},tx);return [job.id];
  }
  const paidAt=new Date(`${entry.date}T12:00:00Z`);
  const data={status:'PAID' as const,amount:new Prisma.Decimal(entry.amountMinor).div(100),paidAt,providerRef:entry.bankReference,paymentReference:entry.orderNumber,expiresAt:null,rawResponse:{bankAccount:entry.account,statement:entry.statement,sourceHash:entry.sourceHash,statementDate:entry.date}};
  const pending=order.payments.find(p=>p.method==='UPLATA_NA_RACUN'&&p.provider==='MANUAL'&&p.status==='PENDING');
  if(pending)await tx.payment.update({where:{id:pending.id},data});
  else await tx.payment.create({data:{...data,orderId:order.id,method:'UPLATA_NA_RACUN',provider:'MANUAL',currency:'RSD'}});
  const status=order.status==='KREIRANO'?'POTVRDJENO':order.status;
  await tx.order.update({where:{id:order.id},data:{status,expiresAt:null}});
  await tx.orderStatusEvent.create({data:{orderId:order.id,status,note:`Uplata na račun evidentirana iz bankarskog izvoda ${entry.statement}/${entry.date}; ${entry.bankReference}; ${entry.amountMinor/100} RSD.`}});
  const emailJob=await enqueueBackgroundJob({kind:'BANK_PAYMENT_EMAIL',payload:{orderId:order.id,...entry},idempotencyKey:`bank-payment-email:${entry.account}:${entry.bankReference}`},tx);
  // Payment readiness changes here, so release supplier documents in the same transaction.
  for(const fulfillment of order.supplierFulfillments)await enqueueBackgroundJob({kind:'SUPPLIER_SHIPPING_DOCUMENTS_EMAIL',payload:{fulfillmentId:fulfillment.id,dispatchKey:`bank-${entry.bankReference}`},idempotencyKey:`bank-supplier:${entry.bankReference}:${fulfillment.id}`},tx);
  return [emailJob.id];
 },{maxWait:10000,timeout:30000});
}
