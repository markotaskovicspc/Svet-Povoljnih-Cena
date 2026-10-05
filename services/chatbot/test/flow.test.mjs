import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Store } from '../src/store.mjs';
import { isOrderConfirmation } from '../src/security.mjs';
import { Worker } from '../src/worker.mjs';
import {currentPurchaseHistory} from '../src/conversation-context.mjs';
import {unverifiedOrderReply} from '../src/order-reply-guard.mjs';

// Real embedded PostgreSQL for persistence and transaction tests. Advisory locks
// are represented by a single test executor (cross-process locks need staging).
async function setup(channel='facebook') {
  const db=new PGlite();const store=new Store(undefined,randomBytes(32).toString('hex'));
  await store.pool.end();
  const query=async(sql,args)=>{
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}],rowCount:1};
    if(sql.includes('pg_advisory_unlock')||sql.includes('pg_notify'))return {rows:[],rowCount:0};
    if(!args&&sql.includes('CREATE TABLE')){await db.exec(sql);return {rows:[]};}
    const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows??r.rows.length};
  };
  store.pool={query,connect:async()=>({query,release(){}}),end:()=>db.close()};await store.init();
  const calls=[];const worker=new Worker({store,spc:async request=>{calls.push(request);return {ok:true,data:{number:'SPC-TEST-1',accessToken:'test-private',total:2000}};},accounts:[],enabled:true,model:'test',graphVersion:'v25.0',intentFn:async({text,pending})=>isOrderConfirmation(text,pending?.code)?'confirm':text.includes('Promeni')?'change':'question'});
  const event={id:`${channel}:mid-1`,conversation:`${channel}:123:456`,channel,account:'123',sender:'456',timestamp:Date.now(),text:'Moze potvrdjujem',attachments:[],echo:false};
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
test('staff command reads manual messages, creates immediately once, and leaves bot paused',async()=>{
 const {store,worker,event,calls}=await setup();
 try{
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  const manual={...event,id:'facebook:manual',echo:true,botEcho:false,text:'Dogovorili smo jednu peglu, pouzećem.',timestamp:event.timestamp+1};
  await store.accept(manual);await worker.tick();
  const command={...manual,id:'facebook:command',sentByApp:true,text:'/porudzbina',timestamp:event.timestamp+2};
  worker.staffPrepareFn=async({state})=>{assert(state.history.some(m=>m.role==='assistant'&&m.content===manual.text));return {ok:true,quote:{quoteToken:'staff-quote'},items:[{sku:'IRON',qty:1}],fingerprint:'staff-cart'};};
  await store.accept(command);await worker.tick();await store.accept(command);await worker.tick();
  assert.equal(calls.length,1);assert.equal(calls[0].action,'create_order');
  const row=(await store.pool.query('SELECT * FROM spc_chat_conversations')).rows[0];assert.equal(row.paused,true);
  assert.equal(store.decode(row.state).orders.length,1);
  const out=(await store.pool.query('SELECT payload FROM spc_chat_outbox')).rows;assert.equal(out.length,1);assert.equal(store.decode(out[0].payload).allowPaused,true);
 }finally{await store.close();}
});
test('staff preparation timeout keeps phase diagnostics and never blames missing email or leaks raw errors',async()=>{
 const {store,worker,event}=await setup();const notices=[];
 try{
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  worker.staffPrepareFn=async({onProgress})=>{onProgress('cart_check');const e=new Error('raw secret or personal data');e.name='TimeoutError';throw e;};
  worker.spc=async p=>{assert.equal(p.action,'support_handoff');notices.push(p);return {ok:true};};
  const command={...event,id:'facebook:phase-diagnostic',echo:true,botEcho:false,text:'/porudzbina'};
  await store.accept(command);
  for(let i=0;i<3;i++){await store.pool.query('UPDATE spc_chat_events SET next_at=now() WHERE id=$1',[command.id]);await worker.tick();}
  const state=store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state);
  assert.equal(state.staffOrderDiagnostic.phase,'cart_check');assert.equal(state.staffOrderDiagnostic.errorType,'TimeoutError');assert.equal(state.staffOrderDiagnostic.attempts,3);
  assert.equal(notices.length,1);assert.match(notices[0].reason,/cart_check/);assert(!JSON.stringify(notices).includes('raw secret'));
  assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,0);assert.equal(state.orders.length,0);
 }finally{await store.close();}
});
test('customer slash command cannot authorize a pending order',async()=>{
 const {store,worker,event,calls}=await setup();
 try{
  await store.pool.query('DELETE FROM spc_chat_events');await store.accept({...event,text:'/porudzbina'});await worker.tick();
  assert.equal(calls.length,0);assert.equal(store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state).orders.length,0);
 }finally{await store.close();}
});
test('staff command retries the persisted quote after an uncertain ERP write, without rebuilding it',async()=>{
 const {store,worker,event}=await setup();let prepares=0,writes=0;const tokens=[];
 try{
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  worker.staffPrepareFn=async()=>{prepares++;return {ok:true,quote:{quoteToken:'same-staff-quote'},items:[{sku:'IRON',qty:1}],fingerprint:'cart'};};
  worker.spc=async p=>{tokens.push(p.quoteToken);if(++writes===1)throw Error('timeout');return {ok:true,data:{number:'STAFF-1',accessToken:'private',total:1400}};};
  const command={...event,id:'facebook:command-retry',echo:true,botEcho:false,text:'/porudzbina'};
  await store.accept(command);await worker.tick();
  await store.pool.query('UPDATE spc_chat_events SET next_at=now() WHERE id=$1',[command.id]);await worker.tick();
  assert.equal(prepares,1);assert.deepEqual(tokens,['same-staff-quote','same-staff-quote']);
  const state=store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state);assert.equal(state.staffOrder.status,'completed');assert.equal(state.orders.length,1);
 }finally{await store.close();}
});

test('staff preparation rejection emails exact conversation once and never sends or records a customer error',async()=>{
 const {store,worker,event}=await setup();const notices=[];
 const reason='Porudžbina nije kreirana: provera nije pouzdano izdvojila dogovorenu cenu iz prepiske.';
 try{
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  const link='https://business.facebook.com/latest/inbox/all/?selected_item_id=synthetic';
  await store.withConversation(event.conversation,async(row,state,c)=>{state.inboxLink=link;await store.save(c,row.id,state);});
  worker.staffPrepareFn=async()=>({ok:false,message:reason});
  worker.spc=async p=>{assert.equal(p.action,'support_handoff');notices.push(p);return {ok:true};};
  const command={...event,id:'facebook:staff-rejected',echo:true,botEcho:false,text:'/porudzbina'};
  await store.accept(command);await worker.tick();await store.accept(command);await worker.tick();
  assert.equal(notices.length,1);assert.equal(notices[0].conversationLink,undefined);assert.match(notices[0].transcript,/provera nije pouzdano/);
  assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,0);
  const state=store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state);
  assert.equal(state.inboxLink,undefined);assert.equal(state.staffOrderAttention.reason,reason);assert(!state.history.some(m=>m.content===reason));assert.equal(state.orders.length,0);
 }finally{await store.close();}
});

test('transient extraction failure retries full preparation then creates once without another customer confirmation',async()=>{
 const {store,worker,event}=await setup();let prepares=0,writes=0;
 try{
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  worker.staffPrepareFn=async()=>++prepares===1?{ok:false,code:'STAFF_PRICE_EVIDENCE_INVALID',message:'Provera cene nije uspela.'}:{ok:true,quote:{quoteToken:'recovered'},items:[{sku:'IRON',qty:1}],fingerprint:'recovered'};
  worker.spc=async p=>{assert.equal(p.action,'create_order');writes++;return {ok:true,data:{number:'RECOVERED-1',accessToken:'private',total:1000}};};
  const command={...event,id:'facebook:staff-extraction-retry',echo:true,botEcho:false,text:'/porudzbina'};
  await store.accept(command);await worker.tick();
  assert.equal(writes,0);assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,0);
  await store.pool.query('UPDATE spc_chat_events SET next_at=now() WHERE id=$1',[command.id]);await worker.tick();
  assert.equal(prepares,2);assert.equal(writes,1);assert.equal((await store.pool.query('SELECT * FROM spc_chat_support')).rows.length,0);
  const out=(await store.pool.query('SELECT payload FROM spc_chat_outbox')).rows;assert.equal(out.length,1);assert.match(store.decode(out[0].payload).text,/RECOVERED-1.*uspešno kreirana/);
 }finally{await store.close();}
});

test('exhausted preparation retries enqueue durable email; mail outage cannot leak a chat error or repeat preparation',async()=>{
 const {store,worker,event}=await setup();let prepares=0,emails=0;const ids=[];
 try{
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  worker.staffPrepareFn=async()=>{prepares++;return {ok:false,code:'STAFF_CART_CHECK_FAILED',message:'Provera prepiske nije uspela.'};};
  worker.spc=async p=>{assert.equal(p.action,'support_handoff');ids.push(p.id);return {ok:++emails>1};};
  const command={...event,id:'facebook:staff-exhausted',echo:true,botEcho:false,text:'/porudzbina'};
  await store.accept(command);
  for(let i=0;i<3;i++){await store.pool.query('UPDATE spc_chat_events SET next_at=now() WHERE id=$1',[command.id]);await worker.tick();}
  const pending=(await store.pool.query('SELECT status FROM spc_chat_support')).rows;assert.equal(pending.length,1);assert.equal(pending[0].status,'pending');
  await store.pool.query('UPDATE spc_chat_support SET next_at=now()');await worker.tick();await store.accept(command);await worker.tick();
  assert.equal(prepares,3);assert.equal(emails,2);assert.equal(ids[0],ids[1]);
  assert.equal((await store.pool.query('SELECT status FROM spc_chat_support')).rows[0].status,'sent');
  assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,0);
  assert.equal((await store.pool.query('SELECT status FROM spc_chat_events WHERE id=$1',[command.id])).rows[0].status,'failed');
 }finally{await store.close();}
});

test('unknown ERP write outcome emails reconciliation request after bounded retries of the SAME quote',async()=>{
 const {store,worker,event}=await setup();let prepares=0;const tokens=[],notices=[];
 try{
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  worker.staffPrepareFn=async()=>{prepares++;return {ok:true,quote:{quoteToken:'same-uncertain'},items:[{sku:'IRON',qty:1}],fingerprint:'uncertain'};};
  worker.spc=async p=>{if(p.action==='support_handoff'){notices.push(p);return {ok:true};}assert.equal(p.action,'create_order');tokens.push(p.quoteToken);throw Error('lost response');};
  const command={...event,id:'facebook:staff-unknown',echo:true,botEcho:false,text:'/porudzbina'};
  await store.accept(command);for(let i=0;i<3;i++){await store.pool.query('UPDATE spc_chat_events SET next_at=now() WHERE id=$1',[command.id]);await worker.tick();}
  assert.equal(prepares,1);assert.deepEqual(tokens,Array(3).fill('same-uncertain'));assert.equal(notices.length,1);assert.match(notices[0].transcript,/Ishod upisa porudžbine nije potvrđen/);assert.match(notices[0].transcript,/duplikat/);
  assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,0);
  const state=store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state);assert.equal(state.staffOrder.quote.quoteToken,'same-uncertain');assert.equal(state.staffOrder.status,'creating');
 }finally{await store.close();}
});

test('definite ERP rejection emails seller, without false success or exposed customer failure',async()=>{
 const {store,worker,event}=await setup();const calls=[];
 try{
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  worker.staffPrepareFn=async()=>({ok:true,quote:{quoteToken:'rejected'},items:[{sku:'IRON',qty:1}],fingerprint:'rejected'});
  worker.spc=async p=>{calls.push(p);return p.action==='support_handoff'?{ok:true}:{ok:false,error:{code:'QUOTE_EXPIRED'}};};
  const command={...event,id:'facebook:staff-erp-rejected',echo:true,botEcho:false,text:'/porudzbina'};
  await store.accept(command);await worker.tick();
  assert.deepEqual(calls.map(p=>p.action),['create_order','support_handoff']);assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,0);
  assert.equal(store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state).orders.length,0);
 }finally{await store.close();}
});

test('a later successful command suppresses a stale pending failure email for that conversation',async()=>{
 const {store,worker,event}=await setup();let resolved=false,emails=0;
 try{
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  worker.staffPrepareFn=async()=>resolved?{ok:true,quote:{quoteToken:'resolved'},items:[{sku:'IRON',qty:1}],fingerprint:'resolved'}:{ok:false,message:'Razjasnite cenu.'};
  worker.spc=async p=>{if(p.action==='support_handoff'){emails++;return {ok:false};}return {ok:true,data:{number:'RESOLVED-1',total:1000,accessToken:'private'}};};
  const command={...event,id:'facebook:staff-price-first',echo:true,botEcho:false,text:'/porudzbina'};
  await store.accept(command);await worker.tick();assert.equal(emails,1);
  resolved=true;await store.accept({...command,id:'facebook:staff-price-resolved',timestamp:command.timestamp+1});await worker.tick();
  await store.pool.query('UPDATE spc_chat_support SET next_at=now()');await worker.tick();
  assert.equal(emails,1);assert.equal((await store.pool.query('SELECT status FROM spc_chat_support')).rows[0].status,'superseded');
  assert.equal(store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state).staffOrderAttention,undefined);
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
    await store.accept({...event,id:'facebook:plain-confirm',text:'Moze potvrdjujem'});
    await worker.tick();
    assert.equal(calls.length,1);assert.equal(calls[0].action,'create_order');
    await store.accept({...event,id:'facebook:repeat-confirm',text:'da'});
    await worker.tick();
    assert.equal(calls.length,1);
    const replies=(await store.pool.query('SELECT payload FROM spc_chat_outbox')).rows.map(r=>store.decode(r.payload).text);
    assert(replies.some(t=>t.includes('već kreirana')));
  }finally{await store.close();}
});
test('loyalty DA activates only consent even with a stale purchase; next offer needs its own DA',async()=>{
 const {store,worker,event}=await setup();const actions=[];
 worker.spc=async input=>{actions.push(input.action);return {ok:true,email:'buyer@example.com',proof:'accepted',expiresAt:Date.now()+60000};};
 try{
  await store.pool.query('DELETE FROM spc_chat_events');
  await store.withConversation(event.conversation,async(row,state,c)=>{state.loyaltyPending={challenge:'consent',email:'buyer@example.com'};await store.save(c,row.id,state);});
  await store.accept({...event,text:'DA'});await worker.tick();await worker.tick();
  assert.deepEqual(actions,['accept_loyalty']);
  const state=store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state);
  assert.equal(state.pending,undefined);assert.equal(state.orders.length,0);assert.equal(state.loyalty.proof,'accepted');
 }finally{await store.close();}
});

test('shopping photo reaches sales with positional context; later top-item reference retains it without reviving old quote',async()=>{
 const {store,worker,calls,event}=await setup();let reads=0;const received=[];
 try{
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  worker.visionFn=async({state,event})=>{reads++;state.visualContext={eventId:event.id,createdAt:event.timestamp,images:[{imageNumber:1,readable:true,objects:[{position:'gore',description:'pegla'}]}]};};
  worker.answerFn=async({state,event})=>{received.push({text:event.text,visual:state.visualContext,pending:state.pending});return {text:event.text?'Mislite na peglu sa slike?':'Koji artikal sa slike želite?',quoteCreated:false};};
  await store.accept({...event,id:'photo',text:'',attachments:[{type:'image',url:'https://fbcdn.net/a'}]});await worker.tick();
  await store.accept({...event,id:'position',text:'Ovu skroz gore hoću jednu',attachments:[]});await worker.tick();
  assert.equal(reads,1);assert.equal(received.length,2);assert.equal(received[1].visual.images[0].objects[0].position,'gore');assert.equal(received[0].pending,undefined);assert.equal(calls.length,0);
  const row=(await store.pool.query('SELECT * FROM spc_chat_conversations')).rows[0];assert.equal(row.paused,false);
 }finally{await store.close();}
});

test('product image and link are persisted once and sent as distinct Messenger messages',async()=>{
 const {store,worker,calls,event}=await setup();const originalFetch=globalThis.fetch;const sent=[];
 try {
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  worker.accounts=[{channel:'facebook',id:'123',login:'facebook',token:'synthetic'}];
  globalThis.fetch=async(_url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>({message_id:'sent-'+sent.length})};};
  worker.answerFn=async()=>({text:'Urban stolica 1499 RSD https://www.svetpovoljnihcena.rs/p/test',quoteCreated:false,images:[{url:'https://vyebjbcfhgujlvjnoxpl.supabase.co/storage/v1/object/public/product-media/test.png'}]});
  const request={...event,id:'facebook:photo-request',text:'daj sliku'};
  await store.accept(request);await worker.tick();await store.accept(request);await worker.tick();await worker.tick();
  assert.equal(sent.length,2);assert(sent[0].message.text.includes('/p/test'));
  assert.equal(sent[1].message.attachment.type,'image');assert.equal(sent[1].message.metadata,'spc-bot');
  assert.equal(sent[1].recipient.id,'456');assert.equal(calls.length,0);
  assert.equal((await store.pool.query("SELECT * FROM spc_chat_outbox WHERE status='sent'")).rows.length,2);
 } finally {globalThis.fetch=originalFetch;await store.close();}
});

test('definite image rejection does not pause the conversation',async()=>{
 const {store,worker,event}=await setup();const originalFetch=globalThis.fetch;
 try {
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  worker.accounts=[{channel:'facebook',id:'123',login:'facebook',token:'synthetic'}];
  globalThis.fetch=async()=>({ok:false,status:400,json:async()=>({error:{code:100}})});
  await store.withConversation(event.conversation,async(row,_state,c)=>{await store.enqueue(c,'image-rejected',row.id,{imageUrl:'https://example.test/product.png'});});
  await worker.flush();
  assert.equal((await store.pool.query('SELECT paused FROM spc_chat_conversations')).rows[0].paused,false);
  assert.equal((await store.pool.query('SELECT status FROM spc_chat_outbox')).rows[0].status,'failed');
 }finally{globalThis.fetch=originalFetch;await store.close();}
});

test('delivery follow-ups retain natural AI replies about the ten chairs without any new ERP write',async()=>{
 const {store,worker,calls,event}=await setup();
 try{
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  await store.withConversation(event.conversation,async(row,state,c)=>{delete state.pending;state.historyVersion=2;state.orders=[{number:'EXISTING-10',items:[{sku:'CHAIR',name:'ELEGANCE SEAT',qty:10}]}];state.history=[{role:'assistant',content:'Porudžbina EXISTING-10 je uspešno kreirana.'}];await store.save(c,row.id,state);});
  worker.orderReplyCheckFn=input=>unverifiedOrderReply({...input,classify:async()=>({kind:'existing_order',orderNumber:'EXISTING-10'})});
  worker.answerFn=async()=>({text:'Vaša porudžbina je evidentirana. Dostava je obično za 2–3 dana.',quoteCreated:false});
  for(const [n,text] of ['Kad možemo da očekujemo dostavu?','Za ovih 10 stolica što smo naručili'].entries()){
   await store.accept({...event,id:`facebook:delivery-${n}`,text});await worker.tick();
  }
  const state=store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state);
  assert.equal(state.orders.length,1);assert.equal(calls.length,0);assert(!state.pending);
  assert.equal(state.history.filter(m=>m.content.includes('Dostava je obično')).length,2);
  assert(!state.history.some(m=>m.content.includes('Napišite broj porudžbine')));
 }finally{await store.close();}
});

test('model cannot claim an uncreated order is confirmed; pending offer remains available',async()=>{
 const {store,worker,calls,event}=await setup();
 try {
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  await store.withConversation(event.conversation,async(row,state,c)=>{
   state.pending={...state.pending,selectionChecked:true,input:{lines:[{sku:'TEST',qty:1}],shipping:{firstName:'Test',lastName:'Kupac',phone:'0600000000',street:'Test',houseNumber:'1',postalCode:'11000',city:'Beograd'},guestEmail:'test@example.com',paymentMethod:'POUZECE_GOTOVINA',shippingMethod:'KURIR'},totals:{shipping:0,total:2000}};
   await store.save(c,row.id,state);
  });
  worker.answerFn=async()=>({text:'Potvrđeno. Vaša porudžbina je kreirana.',quoteCreated:false});
  await store.accept({...event,id:'facebook:ambiguous',text:'Je li to sve?'});await worker.tick();
  const row=(await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0];
  const state=store.decode(row.state);
  assert(state.pending);assert.equal(state.orders.length,0);assert.equal(calls.length,0);
  assert.match(state.history.at(-1).content,/još nije kreirana/);
  assert(!state.history.at(-1).content.includes('Potvrđeno.'));
 }finally{await store.close();}
});

for(const [intent,keepsOffer] of [['question',true],['change',false],['cancel',false],['unclear',true]]) {
 test('semantic '+intent+' never creates an order and handles pending offer',async()=>{
  const {store,worker,calls,event}=await setup();
  try {
   worker.intentFn=async()=>intent;
   worker.answerFn=async()=>({text:'Proverimo detalje.',quoteCreated:false});
   await worker.tick();
   const state=store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state);
   assert.equal(calls.length,0);assert.equal(Boolean(state.pending),keepsOffer);
  }finally{await store.close();}
 });
}

async function setupCancellation() {
 const ctx=await setup();
 await ctx.store.withConversation(ctx.event.conversation,async(row,state,c)=>{
  state.historyVersion=2;delete state.pending;
  state.orders=[{number:'SPC-TEST-1',accessToken:'private'}];
  state.cancellation={number:'SPC-TEST-1',items:[{sku:'CHAIR',name:'Stolica',qty:6}],cancellationToken:'cancel-signed',expiresAt:Date.now()+900000};
  await ctx.store.save(c,row.id,state);
 });
 ctx.worker.cancellationIntentFn=async()=> 'confirm';
 ctx.worker.answerFn=async()=>({text:'Kako mogu da pomognem?',quoteCreated:false});
 return ctx;
}
test('cancellation executes only after confirmation and repeated yes cannot create an order',async()=>{
 const {store,worker,calls,event}=await setupCancellation();
 try {
  await worker.tick();assert.equal(calls.length,1);assert.equal(calls[0].action,'cancel_order');
  await store.accept({...event,id:'facebook:repeat',text:'Da'});await worker.tick();assert.equal(calls.length,1);
  const state=store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state);
  assert.equal(state.orders[0].status,'OTKAZANO');assert.equal(state.cancellation,undefined);
 }finally{await store.close();}
});
test('declining, changing topic, uncertain consent and expired request never cancel',async()=>{
 for(const intent of ['decline','other','unclear','expired']) {
  const {store,worker,calls,event}=await setupCancellation();
  try {
   worker.cancellationIntentFn=async()=>intent==='expired'?'confirm':intent;
   if(intent==='expired')await store.withConversation(event.conversation,async(row,state,c)=>{state.cancellation.expiresAt=Date.now()-1000;await store.save(c,row.id,state);});
   await worker.tick();assert.equal(calls.length,0,intent);
  }finally{await store.close();}
 }
});
test('cancellation timeout retries same signed request after restart, even past expiry',async()=>{
 const {store,worker,event}=await setupCancellation();const calls=[];
 worker.spc=async p=>{calls.push(p);if(calls.length===1)throw Error('lost response');return {ok:true,alreadyCancelled:true};};
 try {
  await worker.tick();await store.pool.query("UPDATE spc_chat_events SET next_at=now() WHERE id=$1",[event.id]);
  await store.withConversation(event.conversation,async(row,state,c)=>{state.cancellation.expiresAt=Date.now()-1;await store.save(c,row.id,state);});
  await worker.tick();
  assert.deepEqual(calls.filter(c=>c.action==='cancel_order').map(c=>c.cancellationToken),['cancel-signed','cancel-signed']);
  assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,1);
 }finally{await store.close();}
});
test('blocked cancellation escalates once without claiming success or pausing new questions',async()=>{
 const {store,worker}=await setupCancellation();
 worker.spc=async p=>p.action==='cancel_order'?{ok:false,error:{code:'CANCELLATION_FISCALIZED'}}:{ok:true};
 try {
  await worker.tick();const row=(await store.pool.query('SELECT * FROM spc_chat_conversations')).rows[0];
  assert.equal(row.paused,false);assert.match(store.decode(row.state).history.at(-1).content,/nije otkazana/);
  assert.equal((await store.pool.query('SELECT * FROM spc_chat_support')).rows.length,1);
 }finally{await store.close();}
});

test('yes to a new iron purchase or support question never becomes an old bed receipt',async()=>{
 for(const question of ['Pegla GOLD CORE je 999 din. Da pripremim ponudu?','Želiš da prosledim otkaz kolegi?']){
  const {store,worker,calls,event}=await setup();let answers=0;
  try{
   await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
   await store.withConversation(event.conversation,async(row,state,c)=>{
    delete state.pending;state.historyVersion=2;state.orders=[{number:'OLD-BED'}];
    state.history=[{role:'assistant',content:'Porudžbina OLD-BED je uspešno kreirana. Ukupno: 34155 RSD.'},{role:'user',content:'Daj GOLD CORE jednu'},{role:'assistant',content:question}];
    await store.save(c,row.id,state);
   });
   worker.answerFn=async({state})=>{answers++;assert(currentPurchaseHistory(state).some(m=>m.content==='Daj GOLD CORE jednu'));return {text:'Pripremam novu ponudu.'};};
   await store.accept({...event,id:'facebook:new-yes',text:'Da'});await worker.tick();
   assert.equal(answers,1);assert.equal(calls.length,0);
  }finally{await store.close();}
 }
});

test('legacy wrong-product offer fails selection check before any ERP order write',async()=>{
 const {store,worker,event}=await setup();const actions=[];
 try{
  worker.spc=async p=>{actions.push(p.action);return {ok:true,items:[{sku:'BED',name:'Ležaj VENUS'}]};};
  worker.cartCheckFn=async()=>({ok:false});
  worker.answerFn=async()=>({text:'Želiš jednu peglu GOLD CORE, na iste podatke?'});
  await store.withConversation(event.conversation,async(row,state,c)=>{state.pending.input={lines:[{sku:'BED',qty:1}]};await store.save(c,row.id,state);});
  await worker.tick();assert(!actions.includes('create_order'));
  const state=store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state);
  assert.equal(state.pending,undefined);assert.equal(state.orders.length,0);
 }finally{await store.close();}
});

test('history recovery includes earlier customer details and staff replies without replaying them',async()=>{
 const {store,event}=await setup();
 try{
  const old={...event,id:'facebook:old-contact',text:'test@example.com',timestamp:event.timestamp-10000};
  await store.accept(old);await store.pool.query("UPDATE spc_chat_events SET status='done' WHERE id=$1",[old.id]);
  const staff={...event,id:'facebook:old-staff',text:'GOLD CORE je izbor kupca.',echo:true,botEcho:false,timestamp:event.timestamp-5000};
  await store.accept(staff);await store.pool.query("UPDATE spc_chat_events SET status='skipped' WHERE id=$1",[staff.id]);
  const history=await store.history(store.pool,event.conversation,event);
  assert.deepEqual(history.map(m=>m.role),['user','assistant']);
  assert(history.some(m=>m.content==='test@example.com'));
  assert(!history.some(m=>m.content===event.text));
  assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,0);
 }finally{await store.close();}
});
test('semantic decision is persisted and not reinterpreted after uncertain ERP write',async()=>{
 const {store,worker,event}=await setup();let classifications=0,attempts=0;
 worker.intentFn=async()=>{classifications++;return 'confirm';};
 worker.spc=async()=>{if(++attempts===1)throw Error('response lost');return {ok:true,data:{number:'ORDER-1',accessToken:'private',total:2000}};};
 try {
  await worker.tick();await store.pool.query("UPDATE spc_chat_events SET next_at=now() WHERE id=$1",[event.id]);await worker.tick();
  assert.equal(classifications,1);assert.equal(attempts,2);
  const state=store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state);
  assert.equal(state.orders.length,1);assert.equal(state.confirming,undefined);
 }finally{await store.close();}
});

test('support handoff emails once and next product question still receives a reply',async()=>{
 const {store,worker,event}=await setup();
 try {
  await store.withConversation(event.conversation,async(row,state,c)=>{delete state.pending;await store.save(c,row.id,state);});
  let turns=0;const notifications=[];
  worker.answerFn=async({state})=>{turns++;if(turns===1)state.supportRequest={reason:'Provera kupovine'};return {text:turns===1?'Upit šaljem podršci.':'Imamo pegle. Koji model želiš?'};};
  worker.spc=async p=>{notifications.push(p);return {ok:true};};
  await worker.tick();await store.accept({...event,id:'facebook:next-product',text:'A peglu?'});await worker.tick();await worker.tick();
  assert.equal(turns,2);assert.equal(notifications.length,1);assert.equal(notifications[0].action,'support_handoff');
  assert.equal((await store.pool.query('SELECT paused FROM spc_chat_conversations')).rows[0].paused,false);
  assert.equal((await store.pool.query('SELECT status FROM spc_chat_support')).rows[0].status,'sent');
 }finally{await store.close();}
});

test('failed support email stays queued without stopping shopping or duplicating the notice',async()=>{
 const {store,worker,event}=await setup();
 try {
  await store.withConversation(event.conversation,async(row,state,c)=>{delete state.pending;await store.save(c,row.id,state);});
  worker.answerFn=async({state})=>{state.supportRequest={reason:'Provera uplate'};return {text:'Upit šaljem podršci.'};};
  worker.spc=async()=>{throw Error('Email down');};
  await worker.tick();await store.accept(event);await worker.tick();
  const notices=(await store.pool.query('SELECT * FROM spc_chat_support')).rows;
  assert.equal(notices.length,1);assert.equal(notices[0].status,'pending');assert.equal(notices[0].attempts,1);
  assert.equal((await store.pool.query('SELECT paused FROM spc_chat_conversations')).rows[0].paused,false);
 }finally{await store.close();}
});

test('legacy automatic handoff resumes on a new question, while manual pauses remain',async()=>{
 for(const manual of [false,true]){
  const {store,worker,event}=await setup();
  try{
   await store.withConversation(event.conversation,async(row,state,c)=>{state.handedOff=true;await store.save(c,row.id,state);});
   await store.pause(event.conversation,manual?'Ručna pauza':'Zahtev van kataloga');
   let answers=0;worker.answerFn=async()=>{answers++;return {text:'Koja pegla te zanima?'};};
   await worker.tick();
   assert.equal(answers,manual?0:1);
   assert.equal((await store.pool.query('SELECT paused FROM spc_chat_conversations')).rows[0].paused,manual);
  }finally{await store.close();}
 }
});
import {reclamationMessage} from '../src/reclamation.mjs';
async function setupReclamation() {
 const ctx=await setup();
 await ctx.store.withConversation(ctx.event.conversation,async(row,state,c)=>{
  state.historyVersion=2;delete state.pending;
  state.orders=[{number:'SPC-TEST-1',accessToken:'private'}];
  state.reclamation={number:'SPC-TEST-1',name:'Pegla',input:{sku:'IRON',quantity:1,description:'Ne greje',request:'ZAMENA',category:'KVAR',photos:[]},expiresAt:Date.now()+900000,reclamationToken:'signed-claim'};
  state.reclamationContext={number:'SPC-TEST-1',sku:'IRON',name:'Pegla',photos:[],createdAt:Date.now()};
  state.history=[{role:'assistant',content:reclamationMessage(state.reclamation)}];await ctx.store.save(c,row.id,state);
 });
 ctx.worker.reclamationIntentFn=async()=> 'confirm';ctx.worker.answerFn=async()=>({text:'Kako mogu da pomognem?'});
 return ctx;
}
test('claim confirmation writes once, queues linked support email and leaves conversation usable',async()=>{
 const {store,worker,event}=await setupReclamation();const calls=[];
 worker.spc=async p=>{calls.push(p);return p.action==='submit_reclamation'?{ok:true,id:'case-id',number:'R-1-SPC-TEST-1'}:{ok:true};};
 try {
  await worker.tick();await store.accept({...event,id:'fb:second-yes',text:'da'});await worker.tick();
  assert.equal(calls.filter(c=>c.action==='submit_reclamation').length,1);
  const support=calls.find(c=>c.action==='support_handoff');assert.equal(support.reclamationId,'case-id');
  const row=(await store.pool.query('SELECT * FROM spc_chat_conversations')).rows[0];assert.equal(row.paused,false);assert.equal(store.decode(row.state).reclamation,undefined);
  await store.accept({...event,id:'fb:other-product',text:'A peglu drugu?'});await worker.tick();assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,3);
 } finally {await store.close();}
});
test('claim timeout persists same signed submission and recovers once after expiry',async()=>{
 const {store,worker,event}=await setupReclamation();const calls=[];let attempts=0;
 worker.spc=async p=>{calls.push(p);if(p.action==='submit_reclamation'&&++attempts===1)throw Error('response lost');return {ok:true,id:'case',number:'R-1-SPC-TEST-1'};};
 try {
  await worker.tick();await store.pool.query('UPDATE spc_chat_events SET next_at=now() WHERE id=$1',[event.id]);
  await store.withConversation(event.conversation,async(row,state,c)=>{state.reclamation.expiresAt=Date.now()-1;await store.save(c,row.id,state);});
  worker.reclamationIntentFn=async()=>{throw Error('must not reinterpret confirmed retry');};await worker.tick();
  assert.deepEqual(calls.filter(c=>c.action==='submit_reclamation').map(c=>c.reclamationToken),['signed-claim','signed-claim']);
  assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,1);assert.equal((await store.pool.query('SELECT paused FROM spc_chat_conversations')).rows[0].paused,false);
 } finally {await store.close();}
});
test('claim decline, question, changed item and expired confirmation do not write to ERP',async()=>{
 for(const intent of ['decline','other','unclear','expired']) {
  const {store,worker,event}=await setupReclamation();const calls=[];worker.spc=async p=>{calls.push(p);return {ok:true};};
  try {
   worker.reclamationIntentFn=async()=>intent==='expired'?'confirm':intent;
   if(intent==='expired')await store.withConversation(event.conversation,async(row,state,c)=>{state.reclamation.expiresAt=Date.now()-1;await store.save(c,row.id,state);});
   await worker.tick();assert(!calls.some(c=>c.action==='submit_reclamation'),intent);
  } finally {await store.close();}
 }
});
test('claim photos are bound to selected item and force a fresh summary, never auto-submit',async()=>{
 const {store,worker,event}=await setupReclamation();const calls=[];
 worker.spc=async p=>{calls.push(p);if(p.action==='reclamation_photo')return {ok:true,photo:{url:'reclamation/SPC-TEST-1/IRON/date/photo.jpg',bytes:200}};
  if(p.action==='reclamation_details')return {ok:true,order:{number:p.number,status:'ISPORUCENO',items:[{sku:'IRON',name:'Pegla',qty:1}],reclamations:[]}};
  if(p.action==='prepare_reclamation')return {ok:true,number:p.number,name:'Pegla',input:p.input,reclamationToken:'new-signed-claim',expiresAt:Date.now()+900000};throw Error('no writes');};
 try {
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  await store.accept({...event,id:'fb:photo',text:'da',attachments:[{type:'image',url:'https://scontent.fbcdn.net/test.jpg'}]});await worker.tick();
  assert.deepEqual(calls.map(c=>c.action),['reclamation_photo','reclamation_details','prepare_reclamation']);assert.equal(calls[0].sku,'IRON');
  const state=store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state);
  assert.equal(state.reclamation.input.photos.length,1);assert.match(state.history.at(-1).content,/Fotografije: 1/);
 }finally{await store.close();}
});
test('failed claim creation notifies support without a fake case receipt or a paused chat',async()=>{
 const {store,worker}=await setupReclamation();worker.spc=async p=>p.action==='submit_reclamation'?{ok:false,reason:'ORDER_NOT_DELIVERED'}:{ok:true};
 try {await worker.tick();const row=(await store.pool.query('SELECT * FROM spc_chat_conversations')).rows[0];assert.equal(row.paused,false);assert.match(store.decode(row.state).history.at(-1).content,/još nije upisana/);assert.equal((await store.pool.query('SELECT * FROM spc_chat_support')).rows.length,1);}finally{await store.close();}
});
test('verification code is processed outside the model and grants only claim access',async()=>{
 const {store,worker,event}=await setup();worker.answerFn=async()=>{throw Error('code must not go to model');};
 worker.spc=async p=>{assert.equal(p.action,'reclamation_verify_finish');return {ok:true,proof:'signed-proof',order:{number:'SPC-EXTERNAL',items:[{sku:'IRON',name:'Pegla'}]}};};
 try {
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  await store.withConversation(event.conversation,async(row,state,c)=>{delete state.pending;state.claimVerification={challenge:'challenge'};await store.save(c,row.id,state);});
  await store.accept({...event,id:'fb:code',text:'123456'});await worker.tick();
  const state=store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state);assert.equal(state.claimOrders['SPC-EXTERNAL'].proof,'signed-proof');assert.equal(state.orders.length,0);assert(!JSON.stringify(state.history).includes('123456'));
 }finally{await store.close();}
});

test('complaint before delivery acknowledges existing order instead of denying creation',async()=>{
 const {store,worker,event}=await setup();
 try{
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  await store.withConversation(event.conversation,async(row,state,c)=>{delete state.pending;state.orders=[{number:'SPC-TEST-1',accessToken:'owned'}];await store.save(c,row.id,state);});
  worker.answerFn=async({state,event})=>{
   const {beginReclamation}=await import('../src/reclamation.mjs');
   await beginReclamation({number:'SPC-TEST-1',sku:'TEST',event,state,spc:async()=>({ok:true,order:{number:'SPC-TEST-1',status:'KREIRANO',items:[{sku:'TEST',name:'Bokserice',qty:1}]}})});
   return {text:'Porudžbina je kreirana, ali još nije isporučena.',quoteCreated:false};
  };
  await store.accept({...event,id:'facebook:claim-before-delivery',text:'Hoću da reklamiram, iscepano je'});await worker.tick();
  const state=store.decode((await store.pool.query('SELECT state FROM spc_chat_conversations')).rows[0].state);
  assert.match(state.history.at(-1).content,/SPC-TEST-1 postoji/);
  assert.match(state.history.at(-1).content,/u sistemu još nije označena kao isporučena/);
  assert.match(state.history.at(-1).content,/Tek kada isporuka bude evidentirana mogu da otvorim tiket/);
  assert.doesNotMatch(state.history.at(-1).content,/nije kreirana/);
  assert.equal(state.orders.length,1);assert(!state.reclamation);assert(!state.claimStatusNotice);
 }finally{await store.close();}
});

test('failed photo processing asks for a name, notifies support once and keeps later chat active',async()=>{
 const {store,worker,event}=await setup();const notices=[];
 try{
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  await store.withConversation(event.conversation,async(row,state,c)=>{delete state.pending;state.historyVersion=2;await store.save(c,row.id,state);});
  worker.answerFn=async()=>{throw Error('model timeout');};worker.visionFn=async()=>{throw Error('image timeout');};
  worker.spc=async p=>{notices.push(p);return {ok:true};};
  const photo={...event,id:'failed-image',text:'',attachments:[{type:'image',url:'https://fbcdn.net/photo.jpg'}]};await store.accept(photo);
  for(let i=0;i<3;i++){await store.pool.query('UPDATE spc_chat_events SET next_at=now() WHERE id=$1',[photo.id]);await worker.tick();}
  const row=(await store.pool.query('SELECT * FROM spc_chat_conversations')).rows[0];assert.equal(row.paused,false);
  assert.equal(notices.length,1);assert.equal(notices[0].action,'support_handoff');
  const out=(await store.pool.query('SELECT * FROM spc_chat_outbox')).rows;assert.equal(out.length,1);assert.match(store.decode(out[0].payload).text,/Kako se zove proizvod/);
  worker.answerFn=async()=>({text:'Kuvalo je 1,8 L.'});worker.orderReplyCheckFn=async()=>false;
  await store.accept({...event,id:'after-image-failure',text:'Kuvalo HEAT'});await worker.tick();
  assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,2);
 }finally{await store.close();}
});

test('repeated same support request sends one notice but another problem can still escalate',async()=>{
 const {store,worker,event}=await setup();const notices=[];
 try{
  await store.withConversation(event.conversation,async(row,state,c)=>{delete state.pending;state.historyVersion=2;await store.save(c,row.id,state);});
  worker.orderReplyCheckFn=async()=>false;
  worker.answerFn=async({state,event})=>{state.supportRequest={reason:event.text==='Drugi problem'?'Provera uplate':'Montaža nogara'};return {text:'Prosledio sam Vaš upit korisničkoj podršci.'};};
  worker.spc=async p=>{notices.push(p);return {ok:true};};
  await worker.tick();await store.accept({...event,id:'repeat-support',text:'Pitajte pa mi javite'});await worker.tick();
  assert.equal(notices.length,1);
  const row=(await store.pool.query('SELECT * FROM spc_chat_conversations')).rows[0];assert.equal(row.paused,false);assert.match(store.decode(row.state).history.at(-1).content,/sačekajmo odgovor/);
  await store.accept({...event,id:'different-support',text:'Drugi problem'});await worker.tick();assert.equal(notices.length,2);
 }finally{await store.close();}
});

 test('website confirmation persists one order and delivers its receipt without any Meta send',async()=>{
  const {store,worker,calls,event}=await setup('web');const original=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error('Website must never call Meta');};
  try{
   await store.accept(event);await worker.tick();await worker.tick();
   assert.equal(calls.length,1);assert.equal(calls[0].channel,'web');assert.equal(calls[0].action,'create_order');
   const replies=(await store.pool.query('SELECT * FROM spc_chat_outbox')).rows;assert.equal(replies.length,1);assert.equal(replies[0].status,'sent');assert.match(store.decode(replies[0].payload).text,/SPC-TEST-1/);
  }finally{globalThis.fetch=original;await store.close();}
 });

test('ordinary model failure notifies support once and keeps next customer message usable',async()=>{
 const {store,worker,event,calls}=await setup();
 try{
  await store.withConversation(event.conversation,async(row,state,c)=>{delete state.pending;state.historyVersion=2;await store.save(c,row.id,state);});
  worker.answerFn=async()=>{throw Error('MODEL_TEMPORARY_FAILURE');};
  for(let n=0;n<3;n++){await store.pool.query('UPDATE spc_chat_events SET next_at=now() WHERE id=$1',[event.id]);await worker.tick();}
  let row=(await store.pool.query('SELECT * FROM spc_chat_conversations')).rows[0];assert.equal(row.paused,false);assert.equal(store.decode(row.state).orders.length,0);
  assert.equal(calls.filter(c=>c.action==='support_handoff').length,1);assert.equal(calls.filter(c=>c.action==='create_order').length,0);
  const replies=(await store.pool.query('SELECT payload FROM spc_chat_outbox')).rows;assert.equal(replies.length,1);assert.match(store.decode(replies[0].payload).text,/Možete nastaviti/);
  worker.answerFn=async()=>({text:'Nastavljamo razgovor.',images:[]});worker.orderReplyCheckFn=async()=>null;
  await store.accept({...event,id:'facebook:after-error',text:'Moja adresa je...',timestamp:Date.now()});await worker.tick();
  row=(await store.pool.query('SELECT * FROM spc_chat_conversations')).rows[0];assert.equal(row.paused,false);
  assert.equal((await store.pool.query("SELECT status FROM spc_chat_events WHERE id='facebook:after-error'")).rows[0].status,'done');
 }finally{await store.close();}
});

test('exhausted uncertain order write pauses for reconciliation and emails support without a false receipt',async()=>{
 const {store,worker,event}=await setup();const notices=[];
 try{
  worker.spc=async p=>{if(p.action==='support_handoff'){notices.push(p);return {ok:true};}throw Error('WRITE_TIMEOUT');};
  for(let n=0;n<3;n++){await store.pool.query('UPDATE spc_chat_events SET next_at=now() WHERE id=$1',[event.id]);await worker.tick();}
  const row=(await store.pool.query('SELECT * FROM spc_chat_conversations')).rows[0];assert.equal(row.paused,true);assert(store.decode(row.state).confirming);assert.equal(notices.length,1);assert.match(notices[0].reason,/ERP/);assert.equal((await store.pool.query('SELECT * FROM spc_chat_outbox')).rows.length,0);
  await store.accept({...event,id:'facebook:after-write-error',text:'Da',timestamp:Date.now()});await worker.tick();assert.equal((await store.pool.query('SELECT paused FROM spc_chat_conversations')).rows[0].paused,true);
 }finally{await store.close();}
});
