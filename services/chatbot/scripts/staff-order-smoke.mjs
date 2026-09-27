import assert from 'node:assert/strict';
import {prepareStaffOrder} from '../src/staff-order.mjs';
const model=process.env.OPENAI_MODEL??'gpt-5.4-mini';
const event={id:'synthetic-command',channel:'facebook',conversation:'synthetic-page-buyer',echo:true,text:'/porudzbina',timestamp:Date.now()};
const history=[{role:'user',content:'Uzimam jednu peglu IRON. Petar Petrović, Test ulica 12, Kragujevac 34000, 0601234567, synthetic@example.test. Kurir, pouzećem gotovina.',timestamp:Date.now()-3000},{role:'assistant',content:'Dogovoreno: pegla IRON je 1.000 din, dostava 400 din, ukupno 1.400 din.',timestamp:Date.now()-2000},{role:'user',content:'Može, dogovoreno.',timestamp:Date.now()-1000}];
for(const scenario of ['complete','missing-email','declined','price-changed']){
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
