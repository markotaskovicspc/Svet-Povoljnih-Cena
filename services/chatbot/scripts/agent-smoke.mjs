import assert from 'node:assert/strict';
import { answer } from '../src/agent.mjs';
const calls=[];const state={history:[{role:'user',content:'Ćao, želim da naručim komodu.'},{role:'assistant',content:'Ćao, ja sam AI asistent. Koju komodu želiš?'}],orders:[]};
const spc=async input=>{calls.push(input.action);if(input.action==='search')return {ok:true,items:[{sku:'TEST-001',name:'Test komoda bela',price:2000,available:true}]};if(input.action==='quote')return {ok:true,quoteToken:'synthetic-not-valid-in-SPC',input:input.input,totals:{shipping:500,total:2500},expiresAt:Date.now()+900000};throw Error('Unexpected operation');};
try {
  const result=await answer({event:{channel:'facebook',conversation:'synthetic-test',text:'Želim da naručim test komodu TEST-001, jedan komad. Ja sam Test Kupac, telefon 0600000000, Test ulica 12, Beograd 11000, test@example.com. Kurir, plaćanje pouzećem gotovinom. Proveri artikal i pripremi ponudu za moju potvrdu.'},state,spc,pause:async()=>{},model:process.env.OPENAI_MODEL??'gpt-5.4-mini'});
  assert(result.quoteCreated);assert(state.pending?.code);assert(calls.includes('search'));assert(calls.includes('quote'));assert(!calls.includes('create_order'));
  console.log(JSON.stringify({ok:true,syntheticData:true,actions:calls,confirmationRequired:true}));
} catch(e){console.error(JSON.stringify({ok:false,type:e.name,status:e.status??null,actions:calls}));process.exitCode=1;}
