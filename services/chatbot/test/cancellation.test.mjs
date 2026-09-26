import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCancellation} from '../src/cancellation.mjs';
test('only an order with ownership proof in this conversation can be prepared, never cancelled by agent',async()=>{
 const calls=[],state={orders:[{number:'OWN',accessToken:'private'}],pending:{quoteToken:'old'},reclamation:{}};
 const spc=async p=>{calls.push(p);return {ok:true,number:'OWN',items:[],expiresAt:Date.now()+900000,cancellationToken:'signed'};};
 const event={channel:'facebook',conversation:'fb:owner'};
 assert.equal((await prepareCancellation({number:'OTHER',state,event,spc})).ok,false);assert.equal(calls.length,0);
 await prepareCancellation({number:'OWN',state,event,spc});
 assert.equal(calls[0].action,'prepare_cancellation');assert.equal(calls[0].accessToken,'private');assert.equal(state.pending,undefined);assert.equal(state.cancellation.number,'OWN');
});
