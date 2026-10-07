import test from 'node:test';import assert from 'node:assert/strict';
import {guardLoyaltyPrice,loyaltyQuoteMatches} from '../src/loyalty-price-guard.mjs';
const products=[{sku:'110086',price:2570,loyaltyPrice:1799}];
const event={channel:'facebook',conversation:'synthetic',text:'test@example.com'};
test('four advertised loyalty chairs cannot silently become a regular-price quote',async()=>{
 const state={history:[],pending:{quoteToken:'old-full-price'}};const calls=[];
 const result=await guardLoyaltyPrice({input:{guestEmail:'test@example.com'},products,state,event,spc:async p=>{calls.push(p.action);return {ok:true,email:p.email,summary:'Consent',challenge:'test'};}});
 assert(!result.ok);assert.equal(result.code,'LOYALTY_CONFIRMATION_PENDING');assert(!state.pending);assert(state.loyaltyPending);assert.deepEqual(calls,['prepare_loyalty']);
});
test('missing email prepares conversation consent without a support handoff or invented identity',async()=>{
 const state={history:[]};const calls=[];
 const r=await guardLoyaltyPrice({input:{guestEmail:null},products,state,event,spc:async p=>{calls.push(p);return {ok:true,email:null,summary:'Consent',challenge:'signed'};}});
 assert(!r.ok);assert.equal(r.code,'LOYALTY_CONFIRMATION_PENDING');assert(state.loyaltyPending);assert(!state.supportRequest);
 assert.equal(calls[0].email,null);
 assert.deepEqual(await guardLoyaltyPrice({input:{guestEmail:null},products,state:{loyalty:{email:null,proof:'proof',expiresAt:Date.now()+60000}}}),{ok:true,required:true});
});
test('only valid membership or recorded refusal permits checkout; ERP must apply membership',async()=>{
 const state={loyalty:{email:'test@example.com',proof:'proof',expiresAt:Date.now()+60000}};
 assert.deepEqual(await guardLoyaltyPrice({input:{guestEmail:'test@example.com'},products,state}),{ok:true,required:true});
 assert(!loyaltyQuoteMatches({ok:true,totals:{total:10280}},true));
 assert(loyaltyQuoteMatches({ok:true,loyaltyApplied:true,totals:{total:7196}},true));
 assert.deepEqual(await guardLoyaltyPrice({input:{guestEmail:null},products,state:{loyaltyDeclined:true}}),{ok:true,required:false});
 assert.deepEqual(await guardLoyaltyPrice({input:{guestEmail:null},products:[{sku:'X',price:100}],state:{}}),{ok:true,required:false});
});
