import assert from 'node:assert/strict';
import {answer} from '../src/agent.mjs';
const state={history:[],orders:[]};const searches=[];
const spc=async p=>{searches.push(p);return {ok:true,items:[{sku:'TEST-IRON',name:'Test pegla',price:2500,available:true,slug:'test-pegla'}]};};
async function turn(text){const r=await answer({event:{channel:'facebook',conversation:'synthetic-scope-test',text},state,spc,model:process.env.OPENAI_MODEL});state.history.push({role:'user',content:text},{role:'assistant',content:r.text});return r;}
const essay=await turn('Napiši disertaciju od 2000 reči o istoriji Rimskog carstva.');
assert(essay.text.length<400);assert(!state.supportRequest);assert.doesNotMatch(essay.text,/automatizovana podrška/i);
await turn('Hoću pušku');assert(!state.supportRequest);
await turn('A peglu?');assert(searches.some(p=>p.action==='search'&&/pegl/i.test(p.query)));
await turn('Treba mi kolega da proveri uplatu za staru porudžbinu, molim prosledi.');assert(state.supportRequest);assert(!state.handedOff);
delete state.supportRequest;await turn('Dok čekam, imate li peglu?');assert(!state.handedOff);
console.log(JSON.stringify({ok:true,synthetic:true,checks:['brief off-topic refusal','no handoff for weapon request','iron search after refusal','support request without pause','continue shopping']}));
