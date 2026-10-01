import test from 'node:test';
import assert from 'node:assert/strict';
import {unverifiedOrderReply} from '../src/order-reply-guard.mjs';
const state={orders:[{number:'EXISTING-1',items:[{sku:'CHAIR',qty:10}]}],history:[]};
test('negating order creation before the first purchase does not erase the useful answer',async()=>{
 assert.equal(await unverifiedOrderReply({text:'Porudžbina još nije kreirana. Dostava je 599 din.',state:{orders:[],history:[]},classify:async()=>({kind:'not_order_confirmation',orderNumber:null})}),false);
 assert.equal(await unverifiedOrderReply({text:'Porudžbina je kreirana.',state:{orders:[],history:[]},classify:async()=>({kind:'existing_order',orderNumber:'FAKE'})}),true);
});
test('delivery reply about a stored order does not require repeating its number',async()=>{
 assert.equal(await unverifiedOrderReply({text:'Vaša porudžbina je evidentirana. Dostava je obično za 2–3 dana.',event:{text:'Za ovih 10 stolica'},state,classify:async()=>({kind:'existing_order',orderNumber:'EXISTING-1'})}),false);
});
test('another stored order or a mention of its number cannot legitimize an uncreated new purchase',async()=>{
 const text='Nova porudžbina je kreirana. Prethodna EXISTING-1 je sačuvana.';
 assert.equal(await unverifiedOrderReply({text,state,classify:async()=>({kind:'unverified_new_order',orderNumber:'EXISTING-1'})}),true);
 assert.equal(await unverifiedOrderReply({text,state,classify:async()=>({kind:'existing_order',orderNumber:'OTHER-BUYER'})}),true);
 assert.equal(await unverifiedOrderReply({text,state,classify:async()=>{throw Error('unavailable');}}),true);
});
test('ordinary replies skip review; a false receipt without any actual order stays blocked',async()=>{
 const classify=()=>{throw Error('must not call');};
 assert.equal(await unverifiedOrderReply({text:'Dostava je obično za 2–3 dana.',state,classify}),false);
 assert.equal(await unverifiedOrderReply({text:'Porudžbina je kreirana.',state:{orders:[]},classify}),true);
});
