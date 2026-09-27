import assert from 'node:assert/strict';
import {prepareStaffOrder} from '../src/staff-order.mjs';
import {checkCart} from '../src/cart-check.mjs';
const model=process.env.OPENAI_MODEL??'gpt-5.4-mini';
const event={id:'synthetic-command',channel:'facebook',conversation:'synthetic-page-buyer',echo:true,text:'/porudzbina',timestamp:Date.now()};
const history=[{role:'user',content:'Uzimam jednu peglu IRON. Petar Petrović, Test ulica 12, Kragujevac 34000, 0601234567, synthetic@example.test. Kurir, pouzećem gotovina.',timestamp:Date.now()-3000},{role:'assistant',content:'Dogovoreno: pegla IRON je 1.000 din, dostava 400 din, ukupno 1.400 din.',timestamp:Date.now()-2000},{role:'user',content:'Može, dogovoreno.',timestamp:Date.now()-1000}];
for(const scenario of (process.argv.includes('--chairs-only')?[]:['complete','missing-email','declined','price-changed'])){
 let quotes=0;
 const messages=structuredClone(history);
 if(scenario==='missing-email')messages[0].content=messages[0].content.replace('synthetic@example.test. ','');
 if(scenario==='declined')messages.push({role:'user',content:'Ipak nemojte, odustajem od kupovine.',timestamp:Date.now()});
 const result=await prepareStaffOrder({event,state:{history:messages,orders:[]},model,spc:async request=>{
  if(request.action==='search')return {ok:true,items:[{sku:'IRON',name:'Pegla IRON',price:scenario==='price-changed'?1200:1000,available:true}]};
  if(request.action==='quote'){quotes++;return {ok:true,quoteToken:'synthetic',input:request.input,totals:{total:scenario==='price-changed'?1600:1400}};}
  throw Error('No real writes permitted');
 }});
 assert.equal(result.ok,scenario==='complete',scenario);
 if(scenario==='complete')assert.equal(quotes,1);
 console.log(scenario+': passed');
}
console.log('Synthetic staff-command extraction/cart/price checks passed; no ERP orders or messages sent.');
// Regression: agreed model/color, multiple confirmations and a corrected total.
const chairMessages=[['user','Koliko bi bila dostava za 14 stolica ELEGANCE SEAT crna'],['assistant','Redovna cena je 2.570 din, a loyalty 1.799 din.'],['assistant','Besplatna je dostava za taj iznos.'],['user','Pa prihvatio sam lojaliti'],['assistant','Onda je 1799'],['user','Jel mogu ja sad ovako ovde da poručim'],['user','Po 1799'],['user','14 komada'],['assistant','Može. Pošaljite podatke.'],['user','Petar Petrović, Test 12, Kragujevac 34000, 0601234567, synthetic@example.test'],['user','14 komada crne'],['user','Ako sam dobro izračunao to me košta 25200 din'],['assistant','Tako je 25.186'],['user','Hvala može'],['user','Kako god šalji ti slobodno 14 onih stolica']].map(([role,content],i)=>({role,content,timestamp:Date.now()-20000+i*1000}));
for(const existing of [true,false]){
 const actions=[];
 const r=await prepareStaffOrder({onPlan:p=>console.log('synthetic plan',JSON.stringify(p)),cartCheckFn:args=>checkCart({...args,onDecision:d=>console.log('synthetic chair selection',JSON.stringify(d))}),event,state:{history:chairMessages,orders:[]},model,spc:async p=>{
  actions.push(p.action);
  if(p.action==='search')return {ok:true,items:p.query==='ELEGANCE SEAT crna'?[]:[{sku:'CHAIR',name:'Trpezarijska stolica ELEGANCE SEAT crna',price:2570,loyaltyPrice:1799,available:true}]};
  if(p.action==='existing_loyalty')return {ok:true,active:existing,email:'synthetic@example.test',proof:existing?'synthetic-proof':undefined,expiresAt:Date.now()+60000};
  if(p.action==='quote'){assert.equal(p.input.lines[0].qty,14);assert.equal(p.loyaltyProof,'synthetic-proof');return {ok:true,quoteToken:'synthetic',totals:{total:25186},input:p.input};}
  throw Error('Real writes prohibited');
 }});
 assert.equal(r.ok,existing,r.message);if(!existing)assert(!actions.includes('quote'));console.log('chair agreement, existing membership '+existing+': passed');
}
