import test from 'node:test';
import assert from 'node:assert/strict';
import {readDeliveryQuote} from '../src/delivery-quote.mjs';
const input={city:'Beograd',shippingMethod:'KURIR',lines:[{sku:'CHAIR',qty:4}]};
test('delivery check is read-only, scoped by server and preserves pending orders',async()=>{
 const event={channel:'instagram',conversation:'ig:one',text:'Do Beograda'},state={pending:{test:true},loyalty:{email:'buyer@example.com',proof:'private',expiresAt:Date.now()+10000}};
 const before=structuredClone(state),calls=[];
 const r=await readDeliveryQuote({input,event,state,spc:async p=>{calls.push(p);return {ok:true,shipping:0};}});
 assert.equal(r.shipping,0);assert.deepEqual(state,before);assert.deepEqual(calls,[{action:'delivery_quote',...input,...{channel:event.channel,conversationId:event.conversation},email:'buyer@example.com',loyaltyProof:'private'}]);
});
test('comments and expired membership never manufacture customer contact or consent',async()=>{
 const calls=[];await readDeliveryQuote({input,event:{channel:'facebook',id:'fb:comment',text:'За Београд'},state:{loyalty:{email:'expired@example.com',proof:'expired',expiresAt:0}},spc:async p=>{calls.push(p);return {ok:true,shipping:799};}});
 assert.equal(calls[0].conversationId,'comment:fb:comment');assert(!('email' in calls[0]));assert(!('loyaltyProof' in calls[0]));
});
test('failed, malformed and unavailable quotes do not invent a delivery fee',async()=>{
 for(const result of [{ok:false,error:{code:'PRODUCT_NOT_FOUND'}},{ok:true},{ok:true,shipping:-1},{ok:true,shipping:null}])assert.equal((await readDeliveryQuote({input,event:{channel:'facebook',conversation:'fb:c',text:'Beograd'},spc:async()=>result})).ok,false);
 assert.equal((await readDeliveryQuote({input,event:{text:'Beograd'},spc:async()=>{throw Error('network');}})).ok,false);
});
test('invented city never reaches ERP; supplied and previously saved cities are reusable',async()=>{
 let calls=0;const spc=async()=>{calls++;return {ok:true,shipping:799};};
 assert.equal((await readDeliveryQuote({input,event:{text:'Koliko je dostava?'},spc})).error.code,'DELIVERY_CITY_REQUIRED');assert.equal(calls,0);
 assert.equal((await readDeliveryQuote({input,event:{text:'Koliko je dostava?'},state:{customer:{shipping:{city:'Beograd'}}},spc})).ok,true);
 assert.equal((await readDeliveryQuote({input:{...input,city:'Novi Sad'},event:{text:'u Novom Sadu'},spc})).ok,true);
});
test('unknown quantity asks for clarification without calling ERP',async()=>{
 const result=await readDeliveryQuote({input:{...input,lines:[{sku:'CHAIR',qty:null}]},event:{text:'Beograd'},spc:async()=>{throw Error('Must not call ERP');}});
 assert.equal(result.error.code,'DELIVERY_QUANTITY_REQUIRED');
});
