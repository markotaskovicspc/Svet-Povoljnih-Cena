import test from 'node:test';import assert from 'node:assert/strict';
import {guardLoyaltyPrice,loyaltyQuoteMatches} from '../src/loyalty-price-guard.mjs';
const products=[{sku:'110086',price:2570,loyaltyPrice:1799}];
const event={channel:'facebook',conversation:'synthetic',text:'test@example.com'};
test('four advertised loyalty chairs cannot silently become a regular-price quote',async()=>{
 const state={history:[],pending:{quoteToken:'old-full-price'}};const calls=[];
 const result=await guardLoyaltyPrice({input:{guestEmail:'test@example.com'},products,state,event,spc:async p=>{calls.push(p.action);return {ok:true,email:p.email,summary:'Consent',challenge:'test'};}});
 assert(!result.ok);assert.equal(result.code,'LOYALTY_CONFIRMATION_PENDING');assert(!state.pending);assert(state.loyaltyPending);assert.deepEqual(calls,['prepare_loyalty']);
});
test('missing email never fabricates identity or increases the offered price',async()=>{
 const state={history:[]};const r=await guardLoyaltyPrice({input:{guestEmail:null},products,state,event,spc:()=>{throw Error('No remote call');}});
 assert(!r.ok);assert.match(state.supportRequest.reason,/110086/);assert(!state.pending);
});
test('only valid membership or recorded refusal permits checkout; ERP must apply membership',async()=>{
 const state={loyalty:{email:'test@example.com',proof:'proof',expiresAt:Date.now()+60000}};
 assert.deepEqual(await guardLoyaltyPrice({input:{guestEmail:'test@example.com'},products,state}),{ok:true,required:true});
 assert(!loyaltyQuoteMatches({ok:true,totals:{total:10280}},true));
 assert(loyaltyQuoteMatches({ok:true,loyaltyApplied:true,totals:{total:7196}},true));
 assert.deepEqual(await guardLoyaltyPrice({input:{guestEmail:null},products,state:{loyaltyDeclined:true}}),{ok:true,required:false});
 assert.deepEqual(await guardLoyaltyPrice({input:{guestEmail:null},products:[{sku:'X',price:100}],state:{}}),{ok:true,required:false});
});
