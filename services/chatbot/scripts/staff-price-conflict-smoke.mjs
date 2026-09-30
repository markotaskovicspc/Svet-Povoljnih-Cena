// Synthetic fixture only. Neither real customer data nor ERP writes are used.
import assert from 'node:assert/strict';
import {prepareStaffOrder} from '../src/staff-order.mjs';
const model=process.env.OPENAI_MODEL??'gpt-5.4-mini';
const history=[['assistant','Klub sto ELEGANT LIVING (110155), 2.999 din.'],['user','Ne taj. Jedan kompjuterski LOFT 1999 dinara, poslala sam sliku.'],['assistant','Kompjuter sto LOFT – 80x40 (210026), 1.999 din.'],['user','Taj sto. Test Kupac, Test ulica 83, ulaz C stan br 8, Batajnica.'],['user','test@example.com'],['user','11273 Batajnica'],['assistant','Pošaljite samo broj telefona.'],['user','Imala sam problem sa telefonom. KOMPJUTERSKI sto, 80x40 od1990 dinara. Test Kupac, 11273 Batajnica, Test ulica 83, te. 060 000 0000'],['user','Da li treba ponovo da se prijavim?']].map(([role,content],i)=>({role,content,timestamp:Date.now()-60000+i*1000}));
const event={channel:'facebook',conversation:'synthetic:price-conflict',text:'/porudzbina',echo:true,timestamp:Date.now()};
for(const resolved of [false,true]){
 let quotes=0;
 const state={history:[...history,...(resolved?[{role:'user',content:'Da, važi 1.999 din za jedan LOFT.',timestamp:Date.now()-1000}]:[])],orders:[]};
 const result=await prepareStaffOrder({event,state,model,onPlan:plan=>{
  assert(plan.input,'Known choice and contacts must survive price ambiguity');assert.deepEqual(plan.input.lines,[{sku:'210026',qty:1}]);assert.equal(plan.input.guestEmail,'test@example.com');assert.equal(plan.input.shipping.city,'Batajnica');
  assert.equal(Boolean(plan.priceConflict),!resolved);
  console.log(JSON.stringify({case:resolved?'resolved':'conflict',input:plan.input,priceConflict:plan.priceConflict,unitPrices:plan.unitPrices}));
 },spc:async p=>{
  if(p.action==='search')return {ok:true,items:[{sku:'210026',name:'Kompjuter sto LOFT – 80x40',price:1999,available:true}]};
  assert(resolved,'Must not quote unresolved price');assert.equal(p.action,'quote','No writes');quotes++;return {ok:true,quoteToken:'synthetic',totals:{total:2298},input:p.input};
 }});
 assert.equal(result.ok,resolved,result.message);assert.equal(quotes,resolved?1:0);
 if(!resolved){assert.match(result.message,/1\.999 din/);assert.match(result.message,/1\.990 din/);}
 console.log(JSON.stringify({case:resolved?'resolved':'conflict',ok:result.ok,message:result.message??null,quotes}));
}
console.log('Synthetic price/context checks passed; no messages or ERP writes.');
