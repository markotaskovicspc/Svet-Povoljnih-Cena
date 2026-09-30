import {createHmac,createHash} from 'node:crypto';
import {equal} from './security.mjs';
import {customerFromQuote,currentPurchaseHistory} from './conversation-context.mjs';

// Authenticated operator recovery of an ERP-signed offer. No model and no Meta sends.
export async function completeOperatorQuote({id,quoteToken,secret,store,spc}){
 if(typeof quoteToken!=='string'||quoteToken.length>20000||!secret||secret.length<32)throw Error('INVALID_QUOTE');
 const [data,signature,extra]=quoteToken.split('.');
 if(!data||!signature||extra||!equal(signature,createHmac('sha256',secret).update(`quote:${data}`).digest('base64url')))throw Error('INVALID_QUOTE');
 const quote=JSON.parse(Buffer.from(data,'base64url').toString());
 if(quote.conversationId!==id||!['facebook','instagram'].includes(quote.channel)||!quote.input?.checkoutSessionId||!Array.isArray(quote.input.lines)||!quote.input.lines.length)throw Error('INVALID_QUOTE');
 const input=quote.input,digest=createHash('sha256').update(quoteToken).digest('hex');
 const fingerprint=createHash('sha256').update(JSON.stringify({email:input.guestEmail?.toLowerCase()??'',shipping:input.shipping,lines:[...input.lines].sort((a,b)=>a.sku.localeCompare(b.sku)),payment:input.paymentMethod,shippingMethod:input.shippingMethod})).digest('hex');
 let result;
 await store.withConversation(id,async(row,state,c)=>{
  if(!row||row.channel!==quote.channel)throw Error('INVALID_CONVERSATION');
  const lastCustomer=Math.max(0,...currentPurchaseHistory(state).filter(m=>m.role==='user').map(m=>m.timestamp??0));
  const existing=state.orders.find(o=>o.operatorQuoteDigest===digest||(o.staffFingerprint===fingerprint&&(o.createdAt??0)>=lastCustomer));
  if(existing){result={ok:true,number:existing.number,alreadyCreated:true};return;}
  if(state.confirming||state.cancelling||state.reclamationInFlight||state.submittingReclamation||state.staffOrder?.status==='creating'||(state.operatorOrder&&state.operatorOrder.digest!==digest))throw Error('RECONCILE_PENDING_OPERATION');
  // Persist the exact signed quote before the external call; retries use the same ERP checkout session.
  await store.pause(id,'Ručna pauza');
  state.operatorOrder={digest,quoteToken};await store.save(c,id,state);
  const created=await spc({action:'create_order',channel:quote.channel,conversationId:id,quoteToken});
  if(!created.ok){delete state.operatorOrder;await store.save(c,id,state);result=created;return;}
  const order=created.data;
  if(!order?.number||!order.accessToken)throw Error('MISSING_ORDER_RECEIPT');
  if(!state.orders.some(o=>o.number===order.number))state.orders.push({number:order.number,accessToken:order.accessToken,items:input.lines,createdAt:Date.now(),staffFingerprint:fingerprint,operatorQuoteDigest:digest});
  state.customer=customerFromQuote(input);
  delete state.pending;delete state.confirming;delete state.operatorOrder;
  state.history.push({role:'assistant',content:`Porudžbina ${order.number} je uspešno kreirana. Ukupno sa dostavom: ${order.total} RSD.`,timestamp:Date.now()});
  await store.save(c,id,state);
  result={ok:true,number:order.number,total:order.total,shipping:order.shipping,status:'created'};
 });
 if(!result)throw Error('CONVERSATION_BUSY');
 return result;
}
