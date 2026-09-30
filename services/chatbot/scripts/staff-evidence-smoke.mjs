import assert from 'node:assert/strict';
import {checkCart} from '../src/cart-check.mjs';import {prepareStaffOrder} from '../src/staff-order.mjs';
const model=process.env.OPENAI_MODEL??'gpt-5.4-mini';
const history=[['user','dobar dan,jel mogu da porucim ove od 1800 4 komada'],['assistant','Da li mislite na Trpezarijsku stolicu ELEGANCE SEAT (110086)? Cena je 2.570 din, a uz loyalty 1.799 din.'],['assistant','Može, 4 komada su dostupna po loyalty ceni od 1.799 din po komadu. Želite li da nastavim sa porudžbinom?'],['user','Test Kupac\nTest ulica 22\nĆuprija 35230\n0600000000'],['assistant','Mejl?'],['user','test@example.com'],['assistant','Proverite porudžbinu: ELEGANCE SEAT (110086) × 4. Dostava: 0 RSD. UKUPNO: 10280 RSD. Za potvrdu napišite DA.'],['assistant','Cena je 7.196'],['assistant','/porudzbina']].map(([role,content],i)=>({role,content,timestamp:Date.now()-60000+i*1000}));
const product={sku:'110086',name:'Trpezarijska stolica ELEGANCE SEAT',price:2570,loyaltyPrice:1799,available:true};
const event={id:'synthetic-command',channel:'facebook',conversation:'synthetic:evidence',echo:true,text:'/porudzbina',timestamp:Date.now()};
for(const [text,qty,ok] of (process.argv.includes('--staff-only')?[]:[['',4,true],['',5,false],['Ipak odustajem',4,false],['Ipak 2 komada',2,true]])){
 const result=await checkCart({state:{history,orders:[]},event:{text},items:[{...product,qty}],model,onDecision:d=>console.log(JSON.stringify({case:'cart',text,qty,decision:d}))});assert.equal(result.ok,ok);
}
for(const active of [true,false]){
 let quotes=0;
 const result=await prepareStaffOrder({event,state:{history,orders:[]},model,onPlan:p=>{console.log(JSON.stringify({case:"plan",plan:p}));assert.equal(p.input?.lines[0].qty,4);assert.equal(p.agreedTotal,7196);},spc:async p=>{
  if(p.action==='search')return {ok:true,items:[product]};
  if(p.action==='existing_loyalty')return {ok:true,active,email:'test@example.com',proof:active?'test':undefined,expiresAt:Date.now()+60000};
  assert.equal(p.action,'quote','No real writes');assert.equal(p.loyaltyProof,'test');quotes++;return {ok:true,quoteToken:'test',input:p.input,totals:{total:7196,shipping:0},loyaltyApplied:true};
 }});
 assert.equal(result.ok,active,result.message);assert.equal(quotes,active?1:0);
 if(!active)assert.match(result.message,/članstvo/);
 console.log(JSON.stringify({case:'staff-full-conversation',active,ok:result.ok,message:result.message??null,quotes}));
}
console.log('Synthetic checks passed. No customer messages or ERP writes.');
