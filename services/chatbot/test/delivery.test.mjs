import test from 'node:test';
import assert from 'node:assert/strict';
import {selectTown,orderErrorMessage} from '../src/delivery.mjs';
import {createSpcClient} from '../src/spc.mjs';
const town={townId:123,name:'Kruševac',postalCode:'37000'};
test('Batajnica resolves through verified API alias without discarding customer postcode',()=>{
 const b={townId:791059,name:'Batajnica',postalCode:'11273',aliases:['Zemun Batajnica','Beograd Batajnica']};
 for(const city of ['Batajnica','Батајница','Zemun - Batajnica'])assert.equal(selectTown([b],{city,postalCode:'11273'}),b);
 assert.equal(selectTown([b],{city:'Batajnica',postalCode:'11080'}),null);
 assert.equal(selectTown([b,{...b,townId:999}],{city:'Batajnica',postalCode:'11273'}),null);
});
test('delivery requires unique matching city AND postcode, including Cyrillic/diacritics',()=>{
 for(const city of ['krusevac','Kruševac','Крушевац']) assert.equal(selectTown([town],{city,postalCode:'37000'}),town);
 assert.equal(selectTown([town],{city:'Boljevac',postalCode:'37000'}),null);
 assert.equal(selectTown([town],{city:'Kruševac',postalCode:'11000'}),null);
 assert.equal(selectTown([town,{...town,townId:456}],{city:'Kruševac',postalCode:'37000'}),null);
 assert(!orderErrorMessage('DELIVERY_ADDRESS_INVALID').includes('istekla'));
});
test('quote sends courier dictionary ID to ERP and rejects unmatched address before quote',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url:String(url),body:options?.body});return {ok:true,json:async()=>options?.body?{ok:true,input:JSON.parse(options.body).input}:{items:[town]}};};
 try {
  const client=createSpcClient('https://www.svetpovoljnihcena.rs','synthetic-secret');
  const quote=await client({action:'quote',input:{shippingMethod:'KURIR',shipping:{city:'krusevac',postalCode:'37000'}}});
  assert.equal(quote.input.shipping.xExpressTownId,123);assert.equal(quote.input.shipping.city,'Kruševac');
  const bad=await client({action:'quote',input:{shippingMethod:'KURIR',shipping:{city:'unknown',postalCode:'37000'}}});
  assert.equal(bad.error.code,'DELIVERY_ADDRESS_INVALID');assert.equal(calls.filter(c=>c.body).length,1);
 } finally {globalThis.fetch=original;}
});

test('staff quote resolves optional postcode and omits null email while preserving approval',async()=>{
 const original=globalThis.fetch;let sent;
 globalThis.fetch=async(url,options)=>({ok:true,json:async()=>options?.body?(sent=JSON.parse(options.body),{ok:true}):{items:[town]}});
 try{
  const staffPricing={commandId:'seller-1',prices:[{sku:'TABLE',price:2999}]};
  await createSpcClient('https://example.test','synthetic')({action:'staff_quote',staffPricing,input:{guestEmail:null,shipping:{city:'Kruševac',postalCode:null}}});
  assert.equal(sent.action,'staff_quote');assert.deepEqual(sent.staffPricing,staffPricing);assert(!('guestEmail' in sent.input));assert.equal(sent.input.shipping.postalCode,'37000');assert.equal(sent.input.shipping.xExpressTownId,123);
 }finally{globalThis.fetch=original;}
});
