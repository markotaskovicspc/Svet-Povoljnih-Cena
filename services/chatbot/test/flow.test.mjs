import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Store } from '../src/store.mjs';
import { Worker } from '../src/worker.mjs';

// Real embedded PostgreSQL for persistence and transaction tests. Advisory locks
// are represented by a single test executor (cross-process locks need staging).
async function setup() {
  const db=new PGlite();const store=new Store(undefined,randomBytes(32).toString('hex'));
  await store.pool.end();
  const query=async(sql,args)=>{
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}],rowCount:1};
    if(sql.includes('pg_advisory_unlock')||sql.includes('pg_notify'))return {rows:[],rowCount:0};
    if(!args&&sql.includes('CREATE TABLE')){await db.exec(sql);return {rows:[]};}
    const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows??r.rows.length};
  };
  store.pool={query,connect:async()=>({query,release(){}}),end:()=>db.close()};await store.init();
  const calls=[];const worker=new Worker({store,spc:async request=>{calls.push(request);return {ok:true,data:{number:'SPC-TEST-1',accessToken:'test-private',total:2000}};},accounts:[],enabled:true,model:'test',graphVersion:'v25.0'});
  const event={id:'facebook:mid-1',conversation:'facebook:123:456',channel:'facebook',account:'123',sender:'456',timestamp:Date.now(),text:'POTVRĐUJEM ABC123',attachments:[],echo:false};
  await store.accept(event);
  await store.withConversation(event.conversation,async(row,state,c)=>{state.pending={code:'ABC123',quoteToken:'signed_quote'};await store.save(c,row.id,state);});
  return {store,worker,calls,event};
}
test('duplicate webhook creates only one persisted event, one order and one outbox reply',async()=>{
  const {store,worker,calls,event}=await setup();
  try{
    await store.accept(event);await worker.tick();await worker.tick();
    assert.equal(calls.length,1);assert.equal(calls[0].action,'create_order');assert.equal(calls[0].quoteToken,'signed_quote');
    assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,1);
    const row=(await store.pool.query('SELECT * FROM spc_chat_conversations')).rows[0];
    assert.equal(store.decode(row.state).orders[0].number,'SPC-TEST-1');assert.equal(store.decode(row.state).pending,undefined);
    assert(!row.state.includes('test-private'));
  }finally{await store.close();}
});
test('human takeover prevents a queued confirmation from creating an order',async()=>{
  const {store,worker,calls,event}=await setup();
  try{await store.accept({...event,id:'facebook:human-echo',echo:true,botEcho:false,text:'Preuzimam'});await worker.tick();assert.equal(calls.length,0);assert.equal((await store.pool.query('SELECT paused FROM spc_chat_conversations')).rows[0].paused,true);}finally{await store.close();}
});
test('disabled production bot never calls SPC for unknown sender',async()=>{
  const {store,worker,calls}=await setup();
  try{worker.enabled=false;await worker.tick();assert.equal(calls.length,0);}finally{await store.close();}
});
test('restart after uncertain reclamation never repeats the write',async()=>{
  const {store,worker,calls,event}=await setup();
  try{await store.withConversation(event.conversation,async(row,state,c)=>{state.reclamationInFlight=true;state.reclamation={code:'ABC123'};await store.save(c,row.id,state);});await worker.tick();assert.equal(calls.length,0);assert.equal((await store.pool.query('SELECT paused FROM spc_chat_conversations')).rows[0].paused,true);}finally{await store.close();}
});
test('response loss retries same signed quote and creates only one durable reply',async()=>{
  const {store,worker,event}=await setup();let attempts=0;const quoteTokens=[];
  worker.spc=async request=>{quoteTokens.push(request.quoteToken);if(++attempts===1)throw Error('timeout');return {ok:true,data:{number:'SPC-TEST-1',accessToken:'private',total:2000}};};
  try{await worker.tick();await store.pool.query("UPDATE spc_chat_events SET next_at=now() WHERE id=$1",[event.id]);await worker.tick();assert.equal(attempts,2);assert.deepEqual(quoteTokens,['signed_quote','signed_quote']);assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,1);}finally{await store.close();}
});
test('changed shipping details invalidate the previous customer confirmation',async()=>{
  const {store,worker,calls,event}=await setup();
  try {
    await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
    worker.answerFn=async()=>({text:'Koji je novi kućni broj?',quoteCreated:false});
    await store.accept({...event,id:'facebook:change-address',text:'Promeni adresu na drugu ulicu'});
    await worker.tick();
    const state=store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state);
    assert.equal(state.pending,undefined);assert.equal(calls.length,0);
    await store.accept({...event,id:'facebook:stale-confirmation'});await worker.tick();assert.equal(calls.length,0);
  }finally{await store.close();}
});

test('plain confirmation creates pending order once, repeated confirmation does not restart purchase',async()=>{
  const {store,worker,calls,event}=await setup();
  try {
    await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
    worker.answerFn=async()=>{throw Error('Confirmation must not call the model');};
    await store.accept({...event,id:'facebook:plain-confirm',text:'potvrđujem'});
    await worker.tick();
    assert.equal(calls.length,1);assert.equal(calls[0].action,'create_order');
    await store.accept({...event,id:'facebook:repeat-confirm',text:'da'});
    await worker.tick();
    assert.equal(calls.length,1);
    const replies=(await store.pool.query('SELECT payload FROM spc_chat_outbox')).rows.map(r=>store.decode(r.payload).text);
    assert(replies.some(t=>t.includes('već kreirana')));
  }finally{await store.close();}
});
