import test from 'node:test';
import assert from 'node:assert/strict';
import {Usage} from '@openai/agents';
import {answer} from '../src/agent.mjs';

const input={guestEmail:null,shipping:{firstName:'Test',lastName:'Kupac',phone:'0601234567',street:'Test',houseNumber:'23/2',city:'Zemun polje',postalCode:'11185'},lines:[{sku:'BLENDER',qty:1},{sku:'MIXER',qty:1}],paymentMethod:'POUZECE_GOTOVINA',shippingMethod:'KURIR'};
function modelFor(steps){
 let turns=0;
 return {get turns(){return turns;},async getResponse(request){
   let output;
   if(!request.tools.length){output=[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matches:true,reason:'Buyer chose both',evidence:input.lines.map(l=>({...l,conversationQuotes:['Po jedan blender i mikser.']}))})}]}];}
   else {const step=steps[turns++];assert(step,'must stop on the verified tool outcome');output=step.text?[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:step.text}]}]:[{type:'function_call',callId:`call-${turns}`,name:step.name,arguments:JSON.stringify(step.args)}];}
   return {usage:new Usage(),output};
 }};
}
function fixture(){return {event:{text:'Test Kupac, Test 23/2,11185,Zemun polje,0601234567',attachments:[],channel:'web',conversation:'synthetic'},state:{history:[{role:'user',content:'Po jedan blender i mikser.',timestamp:Date.now()}],orders:[]}};}
const searchStep={name:'search_products',args:{query:'BLENDER'}};
test('two-product checkout can exceed six model turns and stops as soon as ERP returns a valid quote',async()=>{
 const model=modelFor([...Array(6).fill(searchStep),{name:'prepare_order',args:input}]);
 const {state,event}=fixture();let quotes=0;
 const spc=async p=>p.action==='search'?{ok:true,items:input.lines.map(l=>({sku:l.sku,name:l.sku,price:100}))}:(quotes++,{ok:true,input:p.input,totals:{total:700,shipping:500},quoteToken:'verified'});
 const r=await answer({state,event,spc,model});assert.equal(model.turns,7);assert.equal(quotes,1);assert.equal(r.quoteCreated,true);assert.match(r.text,/Za potvrdu porudžbine odgovorite: DA/);assert.equal(state.pending.quoteToken,'verified');
});
test('an unresolved locality produces one clarification instead of exhausting turns or handing off',async()=>{
 const model=modelFor([{name:'prepare_order',args:input},{text:'Koje naselje i opština? Dostava je obično 2–3 dana.'}]);const {state,event}=fixture();
 const spc=async p=>p.action==='search'?{ok:true,items:input.lines.map(l=>({sku:l.sku,name:l.sku,price:100}))}:{ok:false,error:{code:'DELIVERY_ADDRESS_INVALID'}};
 const r=await answer({state,event,spc,model});assert.equal(model.turns,2);assert.match(r.text,/naselje i opština/);assert.match(r.text,/2–3 dana/);assert.equal(r.quoteCreated,false);assert(!state.pending);assert(!state.supportRequest);assert.equal(state.customer.shipping.houseNumber,'23/2');
});
test('repeated unresolved locality preserves contact and queues support without ending the answer',async()=>{
 const {state,event}=fixture();state.addressIssue={key:JSON.stringify([input.shipping.city,input.shipping.postalCode])};
 const model=modelFor([{name:'prepare_order',args:input},{text:'Dostava je obično 2–3 dana. Adresu proverava korisnička podrška.'}]);
 const spc=async p=>p.action==='search'?{ok:true,items:input.lines.map(l=>({sku:l.sku,name:l.sku,price:100}))}:{ok:false,error:{code:'DELIVERY_ADDRESS_INVALID'}};
 const result=await answer({state,event,spc,model});assert.match(result.text,/2–3 dana/);assert(state.supportRequest);assert.equal(state.customer.guestEmail,null);assert.equal(state.customer.shipping.phone,input.shipping.phone);assert(!state.pending);
});
test('prepared loyalty consent ends the turn without preparing or confirming purchase',async()=>{
 const model=modelFor([{name:'prepare_loyalty',args:{email:null}}]);const {state,event}=fixture();const calls=[];
 const r=await answer({state,event,model,spc:async p=>(calls.push(p.action),{ok:true,summary:'Članstvo je besplatno. Odgovorite DA.',challenge:'verified'})});
 assert.equal(model.turns,1);assert.deepEqual(calls,['prepare_loyalty']);assert.match(r.text,/Odgovorite DA/);assert(!state.pending);assert.equal(r.quoteCreated,false);
});
