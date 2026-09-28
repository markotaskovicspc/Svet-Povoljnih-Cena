import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {Store} from '../src/store.mjs';
import {CommentWorker,parseComments,searchCommentProducts} from '../src/comments.mjs';
import {parseEvents} from '../src/security.mjs';
import {Worker} from '../src/worker.mjs';
const accounts=[{channel:'facebook',id:'123',login:'facebook',token:'test',appId:'789'},{channel:'instagram',id:'124',login:'facebook',token:'test',appId:'789'}];
const event=()=>({id:'facebook:123:123_10',channel:'facebook',account:'123',commentId:'123_10',postId:'123_9',sender:'456',text:'Cena?',timestamp:Date.now()});
test('catalogue lookup recovers from a verbose model query without hiding real ERP errors',async()=>{
 const calls=[],products=[{sku:'210026',name:'Kompjuter sto LOFT'},{sku:'210029',name:'Otvorena polica LOFT'}];
 const r=await searchCommentProducts(async p=>{calls.push(p.query);return {ok:true,items:p.query==='LOFT'?products:[]};},'LOFT radni sto 1999 SPC katalog');
 assert.deepEqual(r.items,products);assert.deepEqual(calls,['LOFT radni sto 1999 SPC katalog','LOFT']);
 const failedCalls=[];const failure={ok:false,error:{code:'UNAVAILABLE'}};
 assert.equal(await searchCommentProducts(async p=>{failedCalls.push(p.query);return failure;},'Sto LOFT'),failure);assert.equal(failedCalls.length,1);
 const emptyCalls=[];await searchCommentProducts(async p=>{emptyCalls.push(p.query);return {ok:true,items:[]};},'model jedan drugi treci cetvrti');assert.equal(emptyCalls.length,4);
});
async function setup(){
 const db=new PGlite(),store=new Store(undefined,randomBytes(32).toString('hex'));await store.pool.end();
 const query=async(sql,args)=>{if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}],rowCount:1};if(sql.includes('pg_advisory_unlock')||sql.includes('pg_notify'))return {rows:[],rowCount:0};if(!args&&sql.includes('CREATE TABLE')){await db.exec(sql);return {rows:[]};}const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0};};
 store.pool={query,connect:async()=>({query,release(){}}),end:()=>db.close()};await store.init();
 const sends=[],support=[];
 const worker=new CommentWorker({store,accounts,enabled:true,graphVersion:'v26.0',model:'test',spc:async p=>{support.push(p);return {ok:true};},prepare:async()=>({kind:'sales',sku:'210026',product:{sku:'210026',name:'LOFT'},text:'Sto LOFT (210026) je 1.999 din. Koliko komada želite?'}),fetchFn:async(url,options)=>{
  if(options.method==='GET')return Response.json({message:'Sto LOFT',permalink_url:'https://facebook.com/123/posts/9'});
  const body=JSON.parse(options.body);sends.push({url,body});return Response.json(url.endsWith('/messages')?{recipient_id:'456',message_id:'private-1'}:{id:'public-1'});
 }});
 await worker.init();await worker.configure('facebook',true);await store.pool.query("UPDATE spc_comment_settings SET activated_at=now()-interval '1 minute'");
 return {store,worker,sends,support};
}
test('only fresh top-level comments from configured accounts are accepted',()=>{
 const now=Date.now(),value={item:'comment',verb:'add',comment_id:'123_10',post_id:'123_9',parent_id:'123_9',from:{id:'456'},message:'Cena?',created_time:Math.floor(now/1000)};
 const parse=(v=value,id='123')=>parseComments({object:'page',entry:[{id,changes:[{field:'feed',value:v}]}]},accounts,now);
 assert.equal(parse().length,1);
 for(const patch of [{verb:'edited'},{from:{id:'123'}},{parent_id:'123_8'},{created_time:Math.floor(now/1000)-8*86400},{comment_id:'../messages'},{message:''}])assert.equal(parse({...value,...patch}).length,0);
 assert.equal(parse(value,'999').length,0);
 assert.equal(parseComments({object:'instagram',entry:[{id:'124',time:Math.floor(now/1000),changes:[{field:'comments',value:{id:'10',media:{id:'11'},from:{id:'456'},text:'Koliko?'}}]}]},accounts,now).length,1);
});
test('private reply exactly once, public acknowledgement only after success, no messaging window opened',async()=>{
 const {store,worker,sends}=await setup();try{
  const e=event();await worker.accept(e);await worker.accept(e);await worker.tick();await worker.tick();
  assert.equal(sends.length,2);assert.deepEqual(sends[0].body.recipient,{comment_id:e.commentId});assert.equal(sends[0].body.message.metadata,'spc-bot');
  assert(!/1\.999|1999|din/.test(sends[1].body.message));
  const row=(await store.pool.query('SELECT * FROM spc_chat_conversations')).rows[0];assert.equal(Number(row.last_customer),0);assert.equal(row.paused,false);
  await store.withConversation(row.id,async(r,state,c)=>{await store.importCommentContext(c,r.id,state,{timestamp:Date.now()+100});assert(state.history.some(m=>m.content.includes('Cena?')));assert.equal(state.commentOrigin.product.sku,'210026');const n=state.history.length;await store.importCommentContext(c,r.id,state,{timestamp:Date.now()+100});assert.equal(state.history.length,n);});
  const echo=parseEvents({object:'page',entry:[{id:'123',messaging:[{sender:{id:'123'},recipient:{id:'456'},timestamp:Date.now(),message:{mid:'early-echo',is_echo:true,app_id:'789',text:'auto'}}]}]},accounts)[0];await store.accept(echo);assert.equal((await store.pool.query('SELECT paused FROM spc_chat_conversations')).rows[0].paused,false);
 }finally{await store.close();}
});
test('ambiguous send and process restart never repeat DM or falsely publish sent acknowledgement',async()=>{
 const {store,worker,sends}=await setup();try{
  const original=worker.fetchFn;worker.fetchFn=async(url,options)=>{if(options.method==='POST')throw Error('lost response');return original(url,options);};
  await worker.accept(event());await worker.tick();await worker.tick();assert.equal(sends.length,0);
  assert.equal((await store.pool.query('SELECT status FROM spc_comment_events')).rows[0].status,'uncertain');
  await store.pool.query("UPDATE spc_comment_events SET status='sending'");await worker.tick();assert.equal((await store.pool.query('SELECT status FROM spc_comment_events')).rows[0].status,'uncertain');
 }finally{await store.close();}
});
test('disabled, old, own comments and recent repeated sender do not trigger unsolicited messages',async()=>{
 const {store,worker,sends}=await setup();try{
  await worker.configure('facebook',false);await worker.accept(event());assert.equal((await store.pool.query('SELECT * FROM spc_comment_events')).rows.length,0);
  await worker.configure('facebook',true);await worker.accept({...event(),timestamp:Date.now()-86400000});assert.equal((await store.pool.query('SELECT * FROM spc_comment_events')).rows.length,0);
  await store.pool.query("UPDATE spc_comment_settings SET activated_at=now()-interval '1 minute'");
  await worker.accept(event());await worker.tick();await worker.accept({...event(),id:'facebook:123:123_11',commentId:'123_11'});await worker.tick();assert.equal(sends.length,2);
 }finally{await store.close();}
});
test('a new product question reaches an existing bot conversation; staff takeover and support remain separate',async()=>{
 const {store,worker,sends,support}=await setup();try{
  await store.accept({id:'facebook:customer',channel:'facebook',account:'123',sender:'456',conversation:'facebook:123:456',text:'Već pričamo',timestamp:Date.now(),attachments:[]});
  const before=(await store.pool.query('SELECT last_customer FROM spc_chat_conversations')).rows[0].last_customer;
  await worker.accept(event());await worker.tick();assert.equal(sends.length,2);
  assert.equal((await store.pool.query('SELECT last_customer FROM spc_chat_conversations')).rows[0].last_customer,before);
  await store.pool.query('UPDATE spc_chat_conversations SET last_customer=0,paused=true');
  await worker.accept({...event(),id:'facebook:123:123_11',commentId:'123_11'});await worker.tick();assert.equal(sends.length,2);
  assert.equal((await store.pool.query("SELECT reason FROM spc_comment_events WHERE comment_id='123_11'")).rows[0].reason,'Razgovor je preuzeo zaposleni');
  worker.prepare=async()=>({kind:'support',text:''});
  await worker.accept({...event(),id:'facebook:123:123_12',commentId:'123_12',sender:'457',text:'Stiglo polomljeno'});await worker.tick();await worker.tick();await worker.tick();assert.equal(support.length,1);assert.equal(support[0].action,'support_handoff');assert.equal(sends.length,2);
 }finally{await store.close();}
});
test('definite DM rejection has no public claim; public failure never resends a successful DM',async()=>{
 const {store,worker,sends}=await setup();try{
  const original=worker.fetchFn;worker.fetchFn=async(url,options)=>options.method==='POST'?Response.json({error:{code:200}},{status:403}):original(url,options);
  await worker.accept(event());await worker.tick();assert.equal((await store.pool.query('SELECT status FROM spc_comment_events')).rows[0].status,'failed');assert.equal(sends.length,0);
  worker.fetchFn=async(url,options)=>url.endsWith('/comments')?Response.json({error:{code:200}},{status:403}):original(url,options);
  await worker.accept({...event(),id:'facebook:123:123_11',commentId:'123_11',sender:'457'});await worker.tick();await worker.tick();assert.equal(sends.length,1);
  const row=(await store.pool.query("SELECT status,public_status FROM spc_comment_events WHERE comment_id='123_11'")).rows[0];assert.deepEqual(row,{status:'sent',public_status:'failed'});
 }finally{await store.close();}
});
test('sent receipt recovers missing local context without another external send',async()=>{
 const {store,worker,sends}=await setup();try{
  await worker.accept(event());await worker.tick();await store.pool.query('DELETE FROM spc_chat_outbox');await store.pool.query('DELETE FROM spc_chat_conversations');await store.pool.query("UPDATE spc_comment_events SET public_status='waiting'");await worker.tick();
  assert.equal(sends.filter(s=>s.url.endsWith('/messages')).length,1);assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,1);
 }finally{await store.close();}
});
test('customer reply opens the normal chat with original comment and selected product, never creates an order from a comment',async()=>{
 const {store,worker}=await setup();try{
  await worker.accept(event());await worker.tick();
  let answers=0;const bot=new Worker({store,accounts:[],enabled:true,graphVersion:'v26.0',model:'test',spc:async()=>{throw Error('No ERP action expected');},answerFn:async({state,event:e})=>{answers++;assert.equal(state.commentOrigin.product.sku,'210026');assert(state.history.some(m=>m.content.includes('Cena?')));assert.equal(state.history.filter(m=>m.role==='assistant'&&m.content.includes('1.999')).length,1);assert.equal(e.text,'Dva komada');return {text:'Pošaljite podatke za dostavu.',quoteCreated:false};}});
  const incoming={id:'facebook:incoming',channel:'facebook',account:'123',sender:'456',conversation:'facebook:123:456',timestamp:Date.now()+100,text:'Dva komada',attachments:[],echo:false};
  await store.accept(incoming);await bot.tick();assert.equal(answers,1);
  const conversation=(await store.pool.query('SELECT * FROM spc_chat_conversations')).rows[0];assert.equal(Number(conversation.last_customer),incoming.timestamp);assert.equal(store.decode(conversation.state).orders.length,0);
 }finally{await store.close();}
});
test('staff takeover during drafting suppresses the DM; service off does not accept comments',async()=>{
 const {store,worker,sends}=await setup();try{
  worker.enabled=false;await worker.accept(event());assert.equal((await store.pool.query('SELECT * FROM spc_comment_events')).rows.length,0);worker.enabled=true;
  const prepare=worker.prepare;worker.prepare=async args=>{await store.accept({id:'facebook:human',channel:'facebook',account:'123',sender:'456',conversation:'facebook:123:456',timestamp:Date.now(),text:'Preuzimam',echo:true,botEcho:false,attachments:[]});return prepare(args);};
  await worker.accept(event());await worker.tick();assert.equal(sends.length,0);
 }finally{await store.close();}
});
