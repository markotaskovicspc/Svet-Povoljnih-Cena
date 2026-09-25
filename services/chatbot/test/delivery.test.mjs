import test from 'node:test';
import assert from 'node:assert/strict';
import {selectTown,orderErrorMessage} from '../src/delivery.mjs';
import {createSpcClient} from '../src/spc.mjs';
const town={townId:123,name:'Kruševac',postalCode:'37000'};
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
