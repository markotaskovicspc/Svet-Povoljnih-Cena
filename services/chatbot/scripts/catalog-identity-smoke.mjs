import assert from 'node:assert/strict';
import {answer} from '../src/agent.mjs';
const model=process.env.OPENAI_MODEL??'gpt-5.4-mini';
const actual={sku:'100032',name:'POMPEA Ženske slip gaće SEAMLESS, crne, L/XL',price:449,slug:'100032-a5f5a2',available:true,checkedQuantity:1,media:[]};
for(const text of ['Može','Ocu muske crne m','Daj mi muske']) {
 const calls=[];
 const state={history:[{role:'user',content:'Hej uzeo bih sad muske gace'},{role:'assistant',content:'100032 — POMPEA muške boxer gaće SEAMLESS, crne M/L — 499 RSD. Hoćeš da pripremim porudžbinu?'}],orders:[]};
 const spc=async p=>{calls.push(p);assert.equal(p.action,'search','No purchase from incorrect offer');return {ok:true,items:p.query==='100032'?[actual]:[]};};
 const reply=await answer({event:{text,channel:'facebook',conversation:'synthetic'},state,spc,model});
 assert(!state.pending);assert(calls.some(p=>p.query!=='100032'),'Search for actual mens products');
 assert(!/100032[^\n]*muške/i.test(reply.text));
 console.log(JSON.stringify({text,reply:reply.text,queries:calls.map(p=>p.query),noOrderWrites:true}));
}
