import test from 'node:test';import assert from 'node:assert/strict';
import {auditWindow,redactAuditText,conversationAuditPage} from '../src/conversation-audit.mjs';
import {createHttpServer} from '../src/server.mjs';
import {PGlite} from '@electric-sql/pglite';
import {Store} from '../src/store.mjs';
test('audit endpoint requires operator auth and validates its time window',async()=>{
 const server=await createHttpServer({store:{pool:{query:async()=>({rows:[]})}},worker:{},accounts:[],adminToken:'test'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{assert.equal((await fetch(base+'/admin/audit')).status,401);assert.equal((await fetch(base+'/admin/audit',{headers:{authorization:'Bearer test'}})).status,400);}finally{await new Promise(r=>server.close(r));}
 assert.throws(()=>auditWindow(new URLSearchParams('from=2026-01-01&to=2026-03-01')));
});
test('contact masking preserves SKU and prices',()=>{
 const result=redactAuditText('Test Kupac Test ulica 22 061 1234567 test@example.com 110086 × 4, 7.196 din', {shipping:{firstName:'Test',lastName:'Kupac',street:'Test ulica',houseNumber:'22'}});
 assert(!/Test Kupac|Test ulica|1234567|test@example/.test(result));assert.match(result,/110086 × 4, 7.196 din/);
});
test('audit pagination preserves timestamp precision, hides secrets and advances past bot echoes',async()=>{
 const rows=Array.from({length:101},(_,i)=>({id:`id${i}`,conversation:'fb:test',kind:'event',created_at:new Date('2026-01-01'),cursor_time:'2026-01-01 00:00:00.000123+00',payload:{text:'Hi',botEcho:i===0},state:{loyalty:{proof:'secret'},customer:{guestEmail:'secret@example.com'}},channel:'facebook'}));
 const result=await conversationAuditPage({decode:x=>x,pool:{query:async(sql,values)=>{assert(sql.includes('LIMIT 101'));assert.equal(values.length,5);return {rows};}}},{from:new Date(),to:new Date(),cursor:null});
 assert.equal(result.records.length,99);assert(!JSON.stringify(result).includes('secret'));assert.equal(JSON.parse(Buffer.from(result.nextCursor,'base64url'))[0],'2026-01-01 00:00:00.000123+00');
});
test('database audit includes every daily message across pages once and excludes out-of-window records',async()=>{
 const db=new PGlite(),store=new Store(undefined,'ab'.repeat(32));await store.pool.end();
 store.pool={query:(sql,args)=>args?db.query(sql,args):db.exec(sql)};
 try{
  await store.init();
  await db.query('INSERT INTO spc_chat_conversations(id,channel,account,sender,state) VALUES($1,$2,$3,$4,$5)',['test','facebook','page','customer',store.encode({history:[],orders:[]})]);
  const payload=store.encode({text:'4 stolice po 1.799 din',botEcho:false});
  await db.query("INSERT INTO spc_chat_events(id,conversation,payload,status,created_at) SELECT 'e-'||i,'test',$1,'done','2026-01-01 12:00:00.000123+00'::timestamptz FROM generate_series(1,105) i",[payload]);
  await db.query("INSERT INTO spc_chat_outbox(id,conversation,payload,status,created_at) VALUES('reply','test',$1,'sent','2026-01-01 12:00:00.000124+00'),('old','test',$1,'sent','2025-12-30')",[store.encode({text:'Proveravam'})]);
  const window={from:new Date('2026-01-01'),to:new Date('2026-01-02'),cursor:null};
  const first=await conversationAuditPage(store,window);assert.equal(first.records.length,100);
  const second=await conversationAuditPage(store,{...window,cursor:JSON.parse(Buffer.from(first.nextCursor,'base64url'))});
  assert.equal(second.records.length,6);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.records,...second.records].map(r=>r.id)).size,106);
 }finally{await db.close();}
});
