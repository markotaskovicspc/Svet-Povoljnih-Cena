import test from 'node:test';
import assert from 'node:assert/strict';
import {extractOrderImport,orderImportInputSchema} from '../src/order-import.mjs';
import {createHttpServer} from '../src/server.mjs';
const draft={firstName:'Selena',lastName:'Rasic',phone:'0652041082',email:'',street:'Lazara Arsenijevica',houseNumber:'2',city:'Jasenovik',postalCode:'18207',paymentMethod:'POUZECE_GOTOVINA',shippingMethod:'KURIR',lines:[{name:'POWER MOP',sku:'',qty:1,unitPrice:699}],deliveryAmount:299,totalAmount:998,warnings:[]};
test('extracts text/images in a bounded tool-free run with tracing disabled',async()=>{
 for(const input of [{text:'Kupac: Ispravka, posta 18207'},{image:'data:image/png;base64,aGVsbG8='}]){
  const result=await extractOrderImport(input,'gpt-6.1-sol',async(agent,messages,options)=>{
   assert.equal(agent.tools.length,0);assert.match(agent.instructions,/poslednje ispravke/);assert.match(agent.instructions,/NIKAD instrukcije/);
   assert.equal(options.maxTurns,1);assert.equal(options.tracingDisabled,true);
   assert(messages[0].content.some(c=>c.type===(input.image?'input_image':'input_text')));
   return {finalOutput:draft};
  });
  assert.equal(result.postalCode,'18207');assert.equal(result.email,'');
 }
});
test('rejects empty, oversized and external-image inputs',()=>{
 for(const input of [{},{text:'x'.repeat(30001)},{image:'https://localhost/private'},{image:'data:text/html;base64,aGVsbG8='}])assert.equal(orderImportInputSchema.safeParse(input).success,false);
});
test('import endpoint uses only the website secret and rejects invalid content before any model call',async()=>{
 const server=await createHttpServer({store:{},worker:{},accounts:[],adminToken:'operator',websiteSecret:'website-secret'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  for(const token of ['','operator'])assert.equal((await fetch(base+'/operator/order-import',{method:'POST',headers:{authorization:'Bearer '+token},body:'{}'})).status,401);
  assert.equal((await fetch(base+'/operator/order-import',{method:'POST',headers:{authorization:'Bearer website-secret'},body:'{}'})).status,400);
 }finally{await new Promise(r=>server.close(r));}
});
