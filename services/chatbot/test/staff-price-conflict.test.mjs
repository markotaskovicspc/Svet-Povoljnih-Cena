import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareStaffOrder} from '../src/staff-order.mjs';
const earlier='Ne taj. Hoću jedan kompjuterski LOFT 1999 dinara.';
const latest='Kompjuterski sto 80x40 od1990 dinara. Test Kupac, Test ulica 83, Batajnica 11273, 0600000000.';
const history=[{role:'assistant',content:'Klub sto OTHER, 2.999 din.'},{role:'user',content:earlier},{role:'assistant',content:'LOFT (210026), cena 1.999 din.'},{role:'user',content:'test@example.com'},{role:'user',content:latest},{role:'user',content:'Da li treba ponovo da se prijavim?'}];
const input={guestEmail:'test@example.com',shipping:{firstName:'Test',lastName:'Kupac',street:'Test ulica',houseNumber:'83',phone:'0600000000',city:'Batajnica',postalCode:'11273'},lines:[{sku:'210026',qty:1}],paymentMethod:'POUZECE_GOTOVINA',shippingMethod:'KURIR'};
const conflict={sku:'210026',basis:'unit',earlierPrice:1999,latestPrice:1990,earlierEvidence:earlier,latestEvidence:latest};
const event={channel:'facebook',conversation:'synthetic:price',text:'/porudzbina'};
const plan={input,reason:'',agreedTotal:null,priceEvidence:null,unitPrices:[],priceConflict:conflict};
test('price-only conflict keeps known contact and choice, names both amounts, never quotes or writes',async()=>{
 const state={history:structuredClone(history),orders:[]};
 const result=await prepareStaffOrder({event,state,model:'test',extractFn:async()=>plan,spc:async()=>{throw Error('No ERP calls for unresolved price');}});
 assert(!result.ok);assert.match(result.message,/1\.999 din/);assert.match(result.message,/1\.990 din/);assert.match(result.message,/210026/);assert.match(result.message,/Koja cena važi/);
 assert(!/mejl|telefon|adresa|nedostaje/i.test(result.message));assert.deepEqual(state.history,history);assert.deepEqual(state.orders,[]);
});
test('invented, reversed, same-price or other-product conflicts are not presented as buyer facts',async()=>{
 for(const invalid of [{...conflict,latestPrice:1900},{...conflict,sku:'OTHER'},{...conflict,latestPrice:1999,latestEvidence:earlier},{...conflict,earlierPrice:1990,earlierEvidence:latest,latestPrice:1999,latestEvidence:earlier}]){
  const result=await prepareStaffOrder({event,state:{history,orders:[]},model:'test',extractFn:async()=>({...plan,priceConflict:invalid}),spc:async()=>{throw Error('No ERP calls');}});
  assert(!result.ok);assert.match(result.message,/greške provere/);assert(!result.message.includes('Koja cena važi'));
 }
});
test('resolving just the price reuses earlier contacts and selection, checks cart and quotes once',async()=>{
 const correction='U redu, jedan LOFT po 1.999 din.';let quotes=0,checks=0;
 const result=await prepareStaffOrder({event,state:{history:[...history,{role:'user',content:correction}],orders:[]},model:'test',extractFn:async()=>({...plan,priceConflict:null,unitPrices:[{sku:'210026',price:1999,evidence:correction}]}),cartCheckFn:async()=>{checks++;return {ok:true};},spc:async p=>{
  if(p.action==='search')return {ok:true,items:[{sku:'210026',name:'LOFT',price:1999,available:true}]};
  assert.equal(p.action,'quote');assert.deepEqual(p.input.shipping,{...input.shipping,country:'RS'});assert.deepEqual(p.input.lines,input.lines);quotes++;return {ok:true,quoteToken:'test',totals:{total:2298}};
 }});
 assert(result.ok,result.message);assert.equal(quotes,1);assert.equal(checks,1);assert.deepEqual(result.customer.shipping,input.shipping);
});
test('only supplied delivery notes reach quote, never invented entrance or apartment',async()=>{
 const correction='Jedan LOFT po 1999 din. Ulaz C stan br 8.';let quotes=0;
 for(const notes of ['Ulaz C stan br 8','Ulaz D stan br 9']){
  const result=await prepareStaffOrder({event,state:{history:[...history,{role:'user',content:correction}],orders:[]},model:'test',extractFn:async()=>({...plan,priceConflict:null,deliveryNotes:notes,unitPrices:[{sku:'210026',price:1999,evidence:correction}]}),cartCheckFn:async()=>({ok:true}),spc:async p=>{
   if(p.action==='search')return {ok:true,items:[{sku:'210026',name:'LOFT',price:1999,available:true}]};assert.equal(p.action,'quote');assert.equal(p.input.notes,'Ulaz C stan br 8');assert.equal(p.input.shipping.houseNumber,'83');quotes++;return {ok:true,totals:{total:2298}};
  }});
  assert.equal(result.ok,notes==='Ulaz C stan br 8');
 }
 assert.equal(quotes,1);
});
