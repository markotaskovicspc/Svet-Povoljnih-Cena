import assert from 'node:assert/strict';
import {answer} from '../src/agent.mjs';
const model=process.env.OPENAI_MODEL??'gpt-5.4-mini';
const product={sku:'TEST-CHAIR',name:'Trpezarijska stolica URBAN SEAT',price:1499,available:true,checkedQuantity:1,slug:'synthetic-chair'};
const state={orders:[],history:[{role:'user',content:'Hoću 6 komada Urban Seat stolice od 1499. Test Kupac, Test 1, Ruma 22400, 0600000000, test@example.com, pouzećem.'},{role:'assistant',content:'Pripremam ponudu za šest Urban Seat stolica, šifra TEST-CHAIR.'}]};
const calls=[];
const spc=async p=>{calls.push(p);if(p.action==='search')return {ok:true,items:[{...product,checkedQuantity:p.quantity??1}]};if(p.action==='quote')return {ok:false,error:{code:'INACTIVE',sku:product.sku}};throw Error('No ERP writes');};
const event={channel:'facebook',conversation:'synthetic-catalog',text:'Može pripremi ponudu.'};
let first=await answer({event,state,spc,model});
if(!state.quoteRejection){state.history.push({role:'user',content:event.text},{role:'assistant',content:first.text}); first=await answer({event:{...event,text:'Da, šest komada šifre TEST-CHAIR, pripremi ponudu.'},state,spc,model});}
assert(!first.quoteCreated);assert(state.supportRequest);assert(state.quoteRejection);assert.match(first.text,/proveru/);
state.history.push({role:'user',content:event.text},{role:'assistant',content:first.text});
const next=await answer({event:{...event,text:'Da, hoću tih 6 istih stolica'},state,spc,model});
assert(!next.quoteCreated);assert.equal(calls.filter(c=>c.action==='quote').length,1,'Never repeat rejected quote');
assert(!calls.some(c=>['create_order','cancel_order'].includes(c.action)));
const location=await answer({event:{...event,text:'Где се налазите?'},state:{history:[],orders:[]},spc,model});
assert.match(location.text,/\/kontakt/);
console.log(JSON.stringify({ok:true,synthetic:true,checks:['catalog-checkout mismatch escalated','same rejected chair not offered repeatedly','location answered','no ERP writes']}));


