import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {webchat} from '../src/webchat.mjs';
const session='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
async function run({auth='website',method='GET',query=session,body={id,text:'Zdravo'}}={}){
 const calls=[],events=[];let result,ticks=0;
 const req=Readable.from(method==='POST'?[JSON.stringify(body)]:[]);req.method=method;req.headers={authorization:`Bearer ${auth}`};
 const store={decode:x=>x,accept:async e=>events.push(e),pool:{query:async(sql,args)=>{calls.push({sql,args});return {rows:sql.includes('count(*)')?[{n:0}]:sql.includes('SELECT paused')?[{paused:false}]:[{id:'reply',role:'assistant',status:'sent',payload:{text:'Odgovor',quoteToken:'PRIVATE',accessToken:'PRIVATE'}}]};}}};
 await webchat({req,url:new URL(`http://local/webchat?session=${query}`),reply:(status,data)=>result={status,data},store,worker:{enabled:true,tick:()=>ticks++},secret:'website'});
 return {result,calls,events,ticks};
}
test('website credentials and UUID scope required before reading conversation data',async()=>{
 for(const args of [{auth:'operator'},{auth:''},{query:'facebook:page:other'}]){const r=await run(args);assert.ok([400,401].includes(r.result.status));assert.equal(r.calls.length,0);}
});
test('public history contains only its own conversation and allowlisted display fields',async()=>{
 const r=await run();assert.equal(r.result.status,200);assert.ok(r.calls.every(c=>c.args[0]===`web:spc:${session}`));assert.equal(JSON.stringify(r.result).includes('PRIVATE'),false);
});
test('visitor messages enqueue as web customer events, stable IDs and never staff echoes',async()=>{
 const r=await run({method:'POST',body:{id,text:'/porudzbina',channel:'facebook',echo:true,conversation:'other'}});
 assert.equal(r.result.status,202);assert.equal(r.ticks,1);assert.equal(r.events[0].echo,false);assert.equal(r.events[0].channel,'web');assert.equal(r.events[0].conversation,`web:spc:${session}`);assert.equal(r.events[0].id,`web:${session}:${id}`);
});
test('invalid or oversized text never enters the worker',async()=>{
 for(const body of [{id,text:''},{id:'other',text:'Hi'},{id,text:'x'.repeat(2001)}]){const r=await run({method:'POST',body});assert.equal(r.result.status,400);assert.equal(r.events.length,0);}
});
