import test from 'node:test';import assert from 'node:assert/strict';import{createHmac}from'node:crypto';
import{completeOperatorQuote}from'../src/operator-order.mjs';
import{executeStaffOrder}from'../src/staff-order.mjs';
const secret='s'.repeat(40),id='facebook:page:person';
const input={checkoutSessionId:'social_synthetic',guestEmail:'buyer@example.com',shipping:{city:'Borča'},lines:[{sku:'CHAIR',qty:1}],paymentMethod:'POUZECE_GOTOVINA',shippingMethod:'KURIR'};
const token=(patch={})=>{const data=Buffer.from(JSON.stringify({channel:'facebook',conversationId:id,input,expiresAt:Date.now()+60000,...patch})).toString('base64url');return data+'.'+createHmac('sha256',secret).update('quote:'+data).digest('base64url');};
function setup(){const state={history:[],orders:[]},calls=[];const store={withConversation:async(_id,fn)=>fn({channel:'facebook'},state,{}),pause:async()=>calls.push('pause'),save:async()=>calls.push('save')};const spc=async p=>{calls.push(p);return {ok:true,data:{number:'SPC-TEST',accessToken:'test',shipping:299,total:1798}};};return {state,calls,store,spc};}
test('operator signed quote writes once, links receipt and keeps chat paused',async()=>{
 const ctx=setup(),quoteToken=token();const r=await completeOperatorQuote({id,quoteToken,secret,...ctx});assert.equal(r.number,'SPC-TEST');
 assert.equal(ctx.state.orders[0].items[0].qty,1);assert.equal(ctx.state.orders[0].accessToken,'test');assert(!ctx.state.operatorOrder);
 assert.equal((await completeOperatorQuote({id,quoteToken,secret,...ctx})).alreadyCreated,true);
 assert.equal((await completeOperatorQuote({id,quoteToken:token({expiresAt:1}),secret,...ctx})).alreadyCreated,true);
 assert.equal(ctx.calls.filter(x=>x.action==='create_order').length,1);assert(ctx.calls.indexOf('save')<ctx.calls.findIndex(x=>x.action));
 assert.match(await executeStaffOrder({event:{},state:ctx.state,prepare:()=>{throw Error('must not extract again');}}),/SPC-TEST je već kreirana/);
});
test('wrong scope and tampered tokens cannot call ERP; unavailable locks cannot create',async()=>{
 const ctx=setup();for(const quoteToken of [token({conversationId:'other'}),token()+'x'])await assert.rejects(completeOperatorQuote({id,quoteToken,secret,...ctx}));assert.equal(ctx.calls.length,0);
 await assert.rejects(completeOperatorQuote({id,quoteToken:token(),secret,...ctx,store:{withConversation:async()=>{}}}),/BUSY/);
});
test('lost response retries the exact checkout, blocks competing operations and preserves its recovery record',async()=>{
 const ctx=setup(),quoteToken=token();await assert.rejects(completeOperatorQuote({id,quoteToken,secret,...ctx,spc:async()=>{throw Error('timeout');}}));assert.equal(ctx.state.operatorOrder.quoteToken,quoteToken);
 await assert.rejects(completeOperatorQuote({id,quoteToken:token({expiresAt:1}),secret,...ctx}),/RECONCILE/);
 assert.equal((await completeOperatorQuote({id,quoteToken,secret,...ctx})).number,'SPC-TEST');
 const pending=setup();pending.state.staffOrder={status:'creating'};await assert.rejects(completeOperatorQuote({id,quoteToken,secret,...pending}),/RECONCILE/);
});
