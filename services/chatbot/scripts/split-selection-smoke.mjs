import assert from 'node:assert/strict';
import {checkCart} from '../src/cart-check.mjs';
import {answer} from '../src/agent.mjs';
const model=process.env.OPENAI_MODEL??'gpt-5.4-mini';
const state={orders:[],history:[{role:'user',content:'Poručila bih jedan kom na adresu\nTest Kupac\nTest ulica 29\n11211 Beograd'},{role:'assistant',content:'Broj telefona, mejl i način plaćanja?'},{role:'user',content:'0600000000\ntest@example.com\nPouzećem'},{role:'assistant',content:'Koji proizvod želite?'},{role:'user',content:'Urban seat'},{role:'assistant',content:'Mislite na Trpezarijsku stolicu URBAN SEAT, 1.499 din?\nTrpezarijska stolica URBAN SEAT (110087)'},{role:'user',content:'Da'},{role:'assistant',content:'Da li je adresa Borča, Test ulica 29, 11211?'}]};
const product={sku:'110087',name:'Trpezarijska stolica URBAN SEAT',qty:1,price:1499,available:true};
const event={channel:'facebook',conversation:'synthetic:split-selection',text:'Jeste Borča'};
for(const [name,latest,qty,expected] of (process.argv.includes('--agent-only')?[]:[['address correction','Jeste Borča',1,true],['wrong quantity','Jeste Borča',2,false],['changed quantity','Ipak dva komada',2,true],['cancellation','Ipak odustajem',1,false]])){
 const result=await checkCart({state,event:{...event,text:latest},items:[{...product,qty}],model,onDecision:d=>console.log(JSON.stringify({case:name,decision:d}))});assert.equal(result.ok,expected,name);console.log(JSON.stringify({case:name,accepted:result.ok}));
}
const calls=[];const spc=async p=>{
 calls.push(p);if(p.action==='search')return {ok:true,items:[product]};
 assert.equal(p.action,'quote','Synthetic ERP permits no writes');
 assert.deepEqual(p.input.lines,[{sku:product.sku,qty:1}]);assert.equal(p.input.shipping.city,'Borča');
 return {ok:true,input:p.input,totals:{shipping:299,total:1798},quoteToken:'synthetic',expiresAt:Date.now()+900000};
};
const result=await answer({state:structuredClone(state),event,spc,model});console.log(JSON.stringify({case:'agent continuation',result,actions:calls.map(p=>p.action)}));assert(result.quoteCreated,'Known cart must progress to quote, not another quantity question');
console.log(JSON.stringify({case:'complete known cart',quotePrepared:result.quoteCreated,actions:calls.map(p=>p.action)}));
const missing={orders:[],history:[state.history[0],{role:'assistant',content:'Koji proizvod želite?'},{role:'user',content:'Urban seat'},{role:'assistant',content:'Trpezarijska stolica URBAN SEAT (110087), jedan komad. Broj telefona i mejl?'}]};
const question=await answer({state:missing,event:{...event,text:'Da, Urban'},spc:async p=>{assert.equal(p.action,'search');return {ok:true,items:[product]};},model});
assert(!/treba mi|fali mi|sistem|korpa|1 komad\?/i.test(question.text),question.text);assert(/telefon|mejl|plaćanj|pouzeć/i.test(question.text),question.text);
console.log(JSON.stringify({case:'only missing contacts',reply:question.text}));
