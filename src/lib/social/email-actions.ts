import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {db} from "@/lib/db";
import {createOrder,createOrderSchema} from "@/lib/api/checkout";
import {getProductBySku} from "@/lib/api/catalog";
import {createReclamationSchema,createSocialReclamation} from "@/lib/api/reclamations";
import {cancelWebOrderByCustomer} from "@/lib/orders/cancellation.server";
import {canCustomerCancelStatus,OrderCancellationError} from "@/lib/orders/cancellation";
import {signSocialQuote,readSocialQuote} from "./security";

const id=z.string().regex(/^[a-f0-9]{64}$/);
const base=z.object({sender:z.email(),requestId:id});
const claim=createReclamationSchema.extend({category:z.enum(['KVAR','FIZICKO_OSTECENJE','NEDOSTAJE_ARTIKAL','POGRESAN_ARTIKAL']),request:z.enum(['POPRAVKA','ZAMENA','POVRACAJ_NOVCA','UMANJENJE_CENE']).nullable()});
export const emailActionSchema=z.discriminatedUnion('action',[
 base.extend({action:z.literal('prepare_cancel'),number:z.string().max(80)}),
 base.extend({action:z.literal('prepare_purchase'),input:createOrderSchema}),
 base.extend({action:z.literal('prepare_claim'),input:claim}),
 z.object({action:z.literal('execute'),sender:z.email(),token:z.string().max(30000),confirmed:z.literal(true)}),
]);
const tokenSchema=z.discriminatedUnion('kind',[
 base.extend({purpose:z.literal('email_action'),kind:z.literal('cancel'),expiresAt:z.number(),orderId:z.string(),number:z.string()}),
 base.extend({purpose:z.literal('email_action'),kind:z.literal('purchase'),expiresAt:z.number(),input:createOrderSchema,total:z.number()}),
 base.extend({purpose:z.literal('email_action'),kind:z.literal('claim'),expiresAt:z.number(),orderId:z.string(),input:claim,claimId:z.string()}),
]);
const owner=(sender:string)=>({OR:[{guestEmail:{equals:sender,mode:'insensitive' as const}},{user:{email:{equals:sender,mode:'insensitive' as const}}}]});
const failure=(code:string)=>({ok:false as const,error:{code}});
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function handleEmailAction(body:z.infer<typeof emailActionSchema>,secret:string){
 if(body.action==='execute'){
  let token;
  try{token=tokenSchema.parse(readSocialQuote(body.token,secret));}catch{return failure('INVALID_EMAIL_ACTION');}
  if(token.sender.toLowerCase()!==body.sender.toLowerCase())return failure('EMAIL_OWNER_MISMATCH');
  if(token.kind==='purchase'){
   const existing=await db.checkoutSession.findUnique({where:{id:token.input.checkoutSessionId!},select:{orderId:true}});
   if(token.expiresAt<Date.now()&&!existing?.orderId)return failure('OFFER_EXPIRED');
   const result=await createOrder(token.input,null,null,{expectedTotal:token.total,customerReplyDraftOnly:true});
   if(!result.ok)return result;
   return {ok:true as const,kind:'purchase',number:result.data.number,orderId:result.data.id,total:result.data.total};
  }
  const order=await db.order.findFirst({where:{id:token.orderId,...owner(body.sender)},select:{id:true,number:true,status:true}});
  if(!order)return failure('EMAIL_OWNER_MISMATCH');
  if(token.kind==='cancel'){
   if(order.status==='OTKAZANO')return {ok:true as const,kind:'cancel',number:order.number,alreadyCancelled:true};
   if(token.expiresAt<Date.now())return failure('OFFER_EXPIRED');
   try{const result=await cancelWebOrderByCustomer({orderId:order.id,requestedViaSocial:'email',customerReplyDraftOnly:true});return {ok:true as const,kind:'cancel',number:order.number,paymentReviewRequired:result.paymentReviewRequired,shipmentReviewRequired:result.activeShipmentCount>0};}
   catch(e){if(e instanceof OrderCancellationError)return failure(e.code);throw e;}
  }
  const existing=await db.reclamation.findUnique({where:{id:token.claimId},select:{id:true,number:true}});
  if(existing)return {ok:true as const,kind:'claim',...existing};
  if(token.expiresAt<Date.now())return failure('OFFER_EXPIRED');
  const result=await createSocialReclamation(token.input,{orderId:order.id,id:token.claimId,customerReplyDraftOnly:true,note:`Prijava mejlom; zahtev ${token.requestId}. Prilozi i originalna prepiska dostupni su u sandučetu podrške.`,type:['KVAR','FIZICKO_OSTECENJE'].includes(token.input.category)?token.input.category as 'KVAR'|'FIZICKO_OSTECENJE':undefined,request:token.input.request??undefined});
  return result.ok?{...result,kind:'claim'}:failure(result.reason);
 }
 const expiresAt=Date.now()+24*60*60000;
 const common={purpose:'email_action' as const,sender:body.sender.toLowerCase(),requestId:body.requestId,expiresAt};
 if(body.action==='prepare_purchase'){
  if(!['POUZECE_GOTOVINA','UPLATA_NA_RACUN'].includes(body.input.paymentMethod))return failure('PAYMENT_UNSUPPORTED');
  const input=createOrderSchema.parse({lines:body.input.lines,shipping:body.input.shipping,paymentMethod:body.input.paymentMethod,shippingMethod:body.input.shippingMethod,billingSameAsShipping:true,guestEmail:body.sender.toLowerCase(),consent:true,checkoutSessionId:`email_${body.requestId}`,notes:`[EMAIL] zahtev ${body.requestId}`});
  const products=await Promise.all(input.lines.map(l=>getProductBySku(l.sku)));
  if(products.some(p=>!p))return failure('PRODUCT_NOT_FOUND');
  const result=await createOrder(input,null,null,{previewOnly:true});if(!result.ok)return result;
  const summary=`Potvrdite porudžbinu:\n${input.lines.map((l,n)=>`${products[n]!.name} (${l.sku}) × ${l.qty}`).join('\n')}\n${input.shipping.firstName} ${input.shipping.lastName}, ${input.shipping.phone}\n${input.shipping.street} ${input.shipping.houseNumber}, ${input.shipping.postalCode} ${input.shipping.city}\nPlaćanje: ${input.paymentMethod==='UPLATA_NA_RACUN'?'uplata na račun':'pouzećem, gotovina'}\nDostava: ${result.data.shipping} RSD\nUkupno: ${result.data.total} RSD\nUslovi: https://www.svetpovoljnihcena.rs/uslovi-kupovine\nOdgovorite na ovaj mejl sa „DA“ da naručite i prihvatite uslove. Ponuda važi 24 sata, uz ponovnu proveru cene i dostupnosti pre upisa.`;
  return {ok:true,kind:'purchase',summary,expiresAt,token:signSocialQuote({...common,kind:'purchase',input,total:result.data.total},secret)};
 }
 const number=body.action==='prepare_cancel'?body.number:body.input.orderNumberOrFiscal;
 const order=await db.order.findFirst({where:{number,...owner(body.sender)},select:{id:true,number:true,status:true,channel:true,items:{select:{sku:true,name:true,qty:true}},fiscal:{select:{id:true}},fiscalDocuments:{where:{kind:'SALE'},select:{id:true}},reshipments:{select:{id:true}}}});
 if(!order)return failure('ORDER_NOT_MATCHED_TO_SENDER');
 if(body.action==='prepare_cancel'){
  if(order.status==='OTKAZANO')return {ok:true,kind:'cancel',alreadyCancelled:true,number:order.number};
  if(order.channel!=='WEB'||!canCustomerCancelStatus(order.status)||order.fiscal||order.fiscalDocuments.length||order.reshipments.length)return failure('CANCELLATION_NOT_ALLOWED');
  const summary=`Da li potvrđujete otkazivanje cele porudžbine ${order.number}?\n${order.items.map(i=>`${i.name} (${i.sku}) × ${i.qty}`).join('\n')}\nOdgovorite na ovaj mejl sa „DA“. Ako je porudžbina plaćena ili predata kuriru, podrška zasebno proverava povraćaj i isporuku. Zahtev važi 24 sata.`;
  return {ok:true,kind:'cancel',summary,expiresAt,token:signSocialQuote({...common,kind:'cancel',orderId:order.id,number:order.number},secret)};
 }
 if(order.status!=='ISPORUCENO')return failure('ORDER_NOT_DELIVERED');
 const item=order.items.find(i=>i.sku===body.input.sku);if(!item||body.input.quantity>item.qty)return failure('ITEM_OR_QUANTITY_MISMATCH');
 if(body.input.photos.length)return failure('EMAIL_PHOTOS_REQUIRE_STAFF');
 const claimId=`email_${digest(body.requestId+JSON.stringify(body.input))}`;
 const requestLabels={POPRAVKA:'popravka',ZAMENA:'zamena',POVRACAJ_NOVCA:'povraćaj novca',UMANJENJE_CENE:'umanjenje cene'};
 const summary=`Da li potvrđujete podnošenje reklamacije za ${order.number}?\n${item.name} (${item.sku}) × ${body.input.quantity}\nProblem: ${body.input.description}\nŽeljeni ishod: ${body.input.request?requestLabels[body.input.request]:'dogovor sa podrškom'}\nOdgovorite na ovaj mejl sa „DA“. Prijem nije odobrenje zamene ili povraćaja. Zahtev važi 24 sata.`;
 return {ok:true,kind:'claim',summary,expiresAt,token:signSocialQuote({...common,kind:'claim',orderId:order.id,input:body.input,claimId},secret)};
}
