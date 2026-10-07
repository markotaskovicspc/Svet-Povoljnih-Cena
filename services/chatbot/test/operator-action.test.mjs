import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {randomBytes,randomUUID} from 'node:crypto';import {Store} from '../src/store.mjs';import {operatorAction} from '../src/operator-action.mjs';import {Worker} from '../src/worker.mjs';import {createHttpServer} from '../src/server.mjs';
async function setup(channel='web'){
 const db=new PGlite(),store=new Store(undefined,randomBytes(32).toString('hex'));await store.pool.end();let locked=true;
 const query=async(sql,args)=>{if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked}]};if(sql.includes('pg_advisory_unlock')||sql.includes('pg_notify'))return {rows:[]};if(!args&&sql.includes('CREATE TABLE')){await db.exec(sql);return {rows:[]};}const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows??r.rows.length};};
 store.pool={query,connect:async()=>({query,release(){}}),end:()=>db.close()};await store.init();const id=channel+':spc:operator-test';
 await query('INSERT INTO spc_chat_conversations(id,channel,account,sender,state,last_customer) VALUES($1,$2,$3,$4,$5,$6)',[id,channel,'spc','operator-test',store.encode({history:[],orders:[],handedOff:true,pending:{quoteToken:'old'}}),Date.now()-172800000]);
 const worker={tick:async()=>{}};const act=body=>operatorAction({store,worker,body:{id,...body}});const row=async()=>(await query('SELECT * FROM spc_chat_conversations WHERE id=$1',[id])).rows[0];return {store,id,act,row,setLock:value=>locked=value};
}
test('takeover suppresses bot replies and idempotent human reply is delivered on old web conversation',async()=>{const s=await setup();try{
 await s.store.enqueue(s.store.pool,'bot',s.id,{text:'Old bot'});await s.store.enqueue(s.store.pool,'human',s.id,{text:'Prior human',human:true});
 assert.equal((await s.act({action:'pause'})).status,200);assert.equal((await s.row()).paused,true);assert.equal(s.store.decode((await s.row()).state).handedOff,undefined);
 const rows=(await s.store.pool.query('SELECT id,status FROM spc_chat_outbox')).rows;assert.equal(rows.find(r=>r.id==='bot').status,'suppressed');assert.equal(rows.find(r=>r.id==='human').status,'pending');
 const body={action:'reply',text:'Odgovor zaposlenog',requestId:randomUUID()};assert.equal((await s.act(body)).status,200);assert.equal((await s.act(body)).status,200);assert.equal((await s.act({...body,text:'Different'})).data.error,'MESSAGE_CONFLICT');
 assert.equal(s.store.decode((await s.row()).state).history.length,1);assert.equal((await s.store.pool.query('SELECT id FROM spc_chat_outbox')).rows.length,3);
 const worker=new Worker({store:s.store,accounts:[],enabled:true});await worker.flush();await worker.flush();assert.equal((await s.store.pool.query("SELECT status FROM spc_chat_outbox WHERE id LIKE 'operator:%'")).rows[0].status,'sent');
 }finally{await s.store.close();}});
test('resume skips backlog and clears old quote but preserves uncertain order creation',async()=>{const s=await setup();try{
 await s.store.pool.query('INSERT INTO spc_chat_events(id,conversation,payload) VALUES($1,$2,$3)',['old',s.id,s.store.encode({text:'Old question'})]);await s.act({action:'pause'});
 assert.equal((await s.act({action:'resume'})).status,200);assert.equal((await s.row()).paused,false);assert.equal(s.store.decode((await s.row()).state).pending,undefined);assert.equal((await s.store.pool.query('SELECT status FROM spc_chat_events')).rows[0].status,'skipped');
 await s.store.withConversation(s.id,async(row,state,c)=>{state.confirming={quoteToken:'unresolved'};await s.store.save(c,row.id,state);});assert.equal((await s.act({action:'resume'})).data.error,'RECONCILIATION_REQUIRED');assert.ok(s.store.decode((await s.row()).state).confirming);
 s.setLock(false);assert.equal((await s.act({action:'pause'})).data.error,'BUSY');assert.equal((await s.act({action:'pause',id:'missing'})).status,404);
 }finally{await s.store.close();}});
test('expired Meta replies are rejected and dedicated credential grants only scoped actions',async()=>{const s=await setup('facebook');let server;try{
 assert.equal((await s.act({action:'reply',text:'Reply',requestId:randomUUID()})).data.error,'MESSAGE_WINDOW_CLOSED');assert.equal((await s.act({action:'complete_order'})).status,400);
 server=await createHttpServer({store:s.store,worker:{enabled:true,tick:async()=>{}},accounts:[],adminToken:'admin',websiteSecret:'integration'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 for(const token of ['','admin'])assert.equal((await fetch(base+'/operator/action',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({id:s.id,action:'pause'})})).status,401);
 assert.equal((await fetch(base+'/operator/action',{method:'POST',headers:{authorization:'Bearer integration','content-type':'application/json'},body:JSON.stringify({id:s.id,action:'complete_order'})})).status,400);
 assert.equal((await fetch(base+'/operator/action',{method:'POST',headers:{authorization:'Bearer integration','content-type':'application/json'},body:JSON.stringify({id:s.id,action:'pause'})})).status,200);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await s.store.close();}});

test('ERP command queues once, never sends literal command, and missing phone escalates',async()=>{const s=await setup('facebook');try{
 await s.store.pool.query('UPDATE spc_chat_conversations SET last_customer=$2 WHERE id=$1',[s.id,Date.now()]);
 const body={action:'reply',text:'/porudzbina',requestId:randomUUID(),actorId:'staff'};
 assert.equal((await s.act(body)).data.command,true);assert.equal((await s.act(body)).data.command,true);
 assert.equal((await s.store.pool.query('SELECT id FROM spc_chat_outbox')).rows.length,0);
 const rows=(await s.store.pool.query('SELECT payload FROM spc_chat_events')).rows;assert.equal(rows.length,1);
 const event=s.store.decode(rows[0].payload);assert.equal(event.operatorCommand,true);assert.equal(event.echo,true);
 const worker=new Worker({store:s.store,accounts:[],enabled:true,staffPrepareFn:async()=>({ok:false,message:'Nedostaje telefon kupca.'}),spc:async()=>({ok:true})});
 await worker.tick();assert.equal((await s.store.pool.query('SELECT status FROM spc_chat_events')).rows[0].status,'done');
 const support=(await s.store.pool.query('SELECT payload FROM spc_chat_support')).rows;assert.equal(support.length,1);assert.match(s.store.decode(support[0].payload).reason,/telefon/);
 }finally{await s.store.close();}});

test('resume catches up only latest unanswered customer message and preserves context',async()=>{const s=await setup();try{
 const now=Date.now();for(const [id,p] of [['first',{text:'Jedan komplet',timestamp:now-2000}],['answer',{text:'Dve četke su uključene',echo:true,timestamp:now-1000}],['last',{text:'Možete poslati',timestamp:now}]])await s.store.pool.query("INSERT INTO spc_chat_events(id,conversation,payload,status) VALUES($1,$2,$3,'skipped')",[id,s.id,s.store.encode(p)]);
 await s.act({action:'resume'});const rows=(await s.store.pool.query('SELECT id,status FROM spc_chat_events')).rows;
 assert.equal(rows.find(r=>r.id==='last').status,'pending');assert.equal(rows.find(r=>r.id==='first').status,'skipped');
 assert.ok(s.store.decode((await s.row()).state).history.some(m=>m.content==='Dve četke su uključene'));
 }finally{await s.store.close();}});
test('order failure alerts after unrelated handoff but identical retry does not spam',async()=>{const s=await setup();try{
 await s.store.pool.query("INSERT INTO spc_chat_support(id,conversation,payload,status) VALUES('old',$1,$2,'sent')",[s.id,s.store.encode({reason:'Sadržaj kompleta'})]);let mails=0;
 const worker=new Worker({store:s.store,accounts:[],spc:async()=>{mails++;return {ok:true};}});
 for(const id of ['staff-order:one','staff-order:two']){await s.store.pool.query('INSERT INTO spc_chat_support(id,conversation,payload) VALUES($1,$2,$3)',[id,s.id,s.store.encode({action:'support_handoff',reason:'Nedostaje telefon'})]);await worker.flushSupport();}
 assert.equal(mails,1);assert.equal((await s.store.pool.query("SELECT status FROM spc_chat_support WHERE id='staff-order:two'")).rows[0].status,'recorded');
 }finally{await s.store.close();}});
