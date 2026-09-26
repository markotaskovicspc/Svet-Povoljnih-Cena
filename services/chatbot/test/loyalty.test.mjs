import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLoyalty,receiveLoyalty,activeLoyalty} from '../src/loyalty.mjs';
import {quoteMessage} from '../src/agent.mjs';
const event={channel:'facebook',conversation:'test-conversation',text:'buyer@example.com',attachments:[]};
test('consent DA cannot confirm an old order and a changed or quoted consent cannot activate',async()=>{
 const calls=[],spc=async input=>{calls.push(input);return input.action==='prepare_loyalty'?{ok:true,email:'buyer@example.com',summary:'Terms DA',challenge:'signed'}:{ok:true,email:'buyer@example.com',proof:'proof',expiresAt:Date.now()+60000};};
 const state={history:[],pending:{quoteToken:'old'}};
 await prepareLoyalty({email:'buyer@example.com',state,event,spc});assert.equal(state.pending,undefined);
 assert.match(await receiveLoyalty({state,event:{...event,text:'DA'},spc}),/Porudžbina još nije kreirana/);
 assert.deepEqual(calls.map(c=>c.action),['prepare_loyalty','accept_loyalty']);
 assert(activeLoyalty(state,'buyer@example.com'));assert.equal(activeLoyalty(state,'other@example.com'),null);
 for(const text of ['Da, ali promeni mejl','> DA','ne']){
  state.loyaltyPending={challenge:'signed',email:'buyer@example.com'};
  await receiveLoyalty({state,event:{...event,text},spc});
 }
 assert.equal(calls.length,2);
});
test('invented email cannot prepare consent',async()=>{
 const result=await prepareLoyalty({email:'other@example.com',event,state:{history:[]},spc:()=>{throw Error('must not call');}});
 assert.equal(result.ok,false);
});
test('quote shows only the ERP first purchase amount with a separate order DA',()=>{
 const text=quoteMessage({loyaltyApplied:true,totals:{shipping:500,total:1690,firstPurchaseDiscount:210},input:{lines:[{sku:'TEST',qty:1}],shipping:{},guestEmail:'buyer@example.com'}});
 assert.match(text,/210 RSD/);assert.match(text,/1690 RSD/);assert.match(text,/potvrdu porudžbine.*DA/);
});
