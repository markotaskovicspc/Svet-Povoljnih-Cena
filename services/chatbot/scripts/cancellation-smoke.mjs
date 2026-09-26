import assert from 'node:assert/strict';
import {classifyCancellation} from '../src/cancellation.mjs';
import {answer} from '../src/agent.mjs';
const model=process.env.OPENAI_MODEL??'gpt-5.4-mini';
const pending={number:'SPC-TEST-1',items:[{sku:'CHAIR',name:'Stolica',qty:6}]};
const history=[{role:'assistant',content:'Da li potvrđujete otkazivanje cele porudžbine SPC-TEST-1?\n6 stolica.'}];
for(const [text,expected] of [['Da, otkaži','confirm'],['Може откажи слободно','confirm'],['Ne otkazuj ipak','decline'],['Da ali samo dve stolice','other'],['A kad bi stiglo?','other'],['A peglu?','other']]) {
 assert.equal(await classifyCancellation({text,history,pending,model}),expected,text);
}
assert.notEqual(await classifyCancellation({text:'da',history:[...history,{role:'assistant',content:'Želiš sliku pegle?'}],pending,model}),'confirm');
const calls=[];
const spc=async p=>{calls.push(p);if(p.action==='prepare_cancellation')return {ok:true,number:pending.number,items:pending.items,expiresAt:Date.now()+900000,cancellationToken:'synthetic'};throw Error('No ERP writes allowed');};
const state={orders:[{number:pending.number,accessToken:'private',items:pending.items}],history:[]};
await answer({event:{text:'Otkaži mi SPC-TEST-1',channel:'facebook',conversation:'synthetic'},state,spc,model});
assert.equal(state.cancellation.number,pending.number);assert.equal(calls.length,1);assert.equal(calls[0].action,'prepare_cancellation');
console.log(JSON.stringify({ok:true,synthetic:true,checks:['natural confirmations','negation','partial cancellation','questions','new topic','yes to unrelated question','preparation only, no ERP write']}));
