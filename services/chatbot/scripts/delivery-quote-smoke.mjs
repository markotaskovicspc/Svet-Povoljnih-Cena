import assert from 'node:assert/strict';
import {answer} from '../src/agent.mjs';
import {prepareCommentReply} from '../src/comments.mjs';
const model=process.env.OPENAI_MODEL??'gpt-5.4-mini';
const product={sku:'110087',name:'Trpezarijska stolica URBAN',price:1499,available:true,checkedQuantity:4};
const history=[{role:'user',content:'Hoću 4 stolice Urban.'},{role:'assistant',content:'Trpezarijska stolica URBAN (110087), četiri komada.'}];
const scenarios=[
 {name:'facebook exact cart',text:'Koliko je dostava za Beograd?',qty:4,amount:799,channel:'facebook'},
 {name:'instagram quantity change',text:'Ipak 6 komada, koliko je dostava za Beograd?',qty:6,amount:999,channel:'instagram'},
 {name:'ask missing city',text:'Koliko je dostava?',channel:'facebook',missing:true},
 {name:'ask missing quantity',text:'Koliko je dostava za Beograd?',channel:'instagram',missingQty:true},
 {name:'free shipping',text:'Koliko je dostava za Novi Sad?',qty:4,amount:0,channel:'instagram'},
 {name:'unavailable quote',text:'Koliko je dostava za Beograd?',qty:4,unavailable:true,channel:'facebook'},
 {name:'comment shipping',text:'Koliko košta dostava za 4 Urban stolice do Beograda?',qty:4,amount:799,channel:'facebook',comment:true},
];
for(const s of scenarios.filter(s=>!process.argv[2]||s.name.includes(process.argv[2]))){
 const calls=[];const spc=async p=>{
  calls.push(p);if(p.action==='search')return {ok:true,items:[product]};
  if(p.action==='product_details')return {ok:true,product};
  assert.equal(p.action,'delivery_quote','No order writes allowed');assert.deepEqual(p.lines,[{sku:product.sku,qty:s.qty}]);assert(p.city);assert.equal(p.shippingMethod,'KURIR');
  return s.unavailable?{ok:false,error:{code:'DELIVERY_PRICE_UNAVAILABLE'}}:{ok:true,shipping:s.amount,currency:'RSD',lines:p.lines,city:p.city,shippingMethod:p.shippingMethod,pricingBasis:'regular',orderCreated:false};
 };
 const event={id:'synthetic-delivery',channel:s.channel,conversation:'synthetic-delivery',text:s.text};
 const conversationHistory=s.missingQty?[{role:'user',content:'Zanima me Urban.'},{role:'assistant',content:'Trpezarijska stolica URBAN (110087) je dostupna.'}]:structuredClone(history);
 const result=s.comment?await prepareCommentReply({event,post:{text:'Trpezarijska stolica URBAN',visual:{images:[]}},spc,model}):await answer({event,state:{history:conversationHistory,orders:[]},spc,model});
 const text=result.text;
 assert(!/pošaljite.*(?:ime|telefon|mejl)|unesite.*(?:ime|telefon|mejl)/i.test(text),text);
 if(s.missing||s.missingQty){assert(!calls.some(c=>c.action==='delivery_quote'));assert((s.missingQty?/koliko|količin/i:/mesto|grad|naselje/i).test(text),text);}
 else {assert(calls.some(c=>c.action==='delivery_quote'));if(s.amount===0)assert(/besplat|0 din|0 RSD/i.test(text),text);else if(!s.unavailable)assert(text.includes(String(s.amount)),text);}
 assert(!result.quoteCreated);console.log(JSON.stringify({case:s.name,text,actions:calls.map(c=>c.action)}));
 if(s.unavailable)assert(!/nije dostupna|nije moguća|kamion/i.test(text),text);
}
