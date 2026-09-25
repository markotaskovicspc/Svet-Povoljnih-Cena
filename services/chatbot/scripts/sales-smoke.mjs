import assert from 'node:assert/strict';
import { answer, quoteMessage } from '../src/agent.mjs';
const model=process.env.OPENAI_MODEL??'gpt-5.4-mini';
const item={sku:'TEST-001',name:'Urban test stolica',slug:'test-stolica',price:1499,available:true,image:{url:'https://vyebjbcfhgujlvjnoxpl.supabase.co/storage/v1/object/public/product-media/test.png'}};
const state={history:[],orders:[]};
const calls=[];
const spc=async input=>{
  calls.push(input);
  if(input.action==='search') return {ok:true,items:[item]};
  if(input.action==='quote') return {ok:true,input:input.input,totals:{total:4497,shipping:0},quoteToken:'synthetic-only',expiresAt:Date.now()+900000};
  throw Error('Unexpected operation');
};
async function turn(text){
  const result=await answer({event:{channel:'facebook',conversation:'synthetic-sales',text},state,spc,model,pause:async()=>{throw Error('Unexpected handoff');}});
  state.history.push({role:'user',content:text},{role:'assistant',content:result.quoteCreated?quoteMessage(state.pending):result.text});
  return result;
}
await turn('Cao, imate li Urban stolicu?');
assert.match(state.history.at(-1).content,/Stefan/);
assert.doesNotMatch(state.history.at(-1).content,/automatizovan/i);
const photo=await turn('Daj sliku te stolice');
assert(photo.text.includes('https://www.svetpovoljnihcena.rs/p/test-stolica'));
assert.equal(photo.images?.[0]?.url,item.image.url);
await turn('Hocu tri. Test Kupac, Test ulica 12, Beograd 11000, 0600000000, pouzece.');
assert.equal(calls.filter(c=>c.action==='quote').length,0,'No invented email or premature quote');
const final=await turn('test@example.com');
assert(final.quoteCreated,'Collect missing email and complete quote');
assert.equal(state.pending.input.shippingMethod,'KURIR');
assert.equal(state.pending.input.lines[0].qty,3);
assert.equal(state.pending.input.shipping.firstName,'Test');
assert.equal(state.pending.input.guestEmail,'test@example.com');
assert(!calls.some(c=>c.action==='create_order'));
assert.match(quoteMessage(state.pending),/kurir/);
console.log(JSON.stringify({ok:true,syntheticData:true,scenarios:['transparent Stefan introduction','verified product photo link','freeform delivery details','ask for missing email','courier quote','explicit confirmation required']}));
