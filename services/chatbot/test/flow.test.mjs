import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Store } from '../src/store.mjs';
import { isOrderConfirmation } from '../src/security.mjs';
import { Worker } from '../src/worker.mjs';
import {currentPurchaseHistory} from '../src/conversation-context.mjs';

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
  const calls=[];const worker=new Worker({store,spc:async request=>{calls.push(request);return {ok:true,data:{number:'SPC-TEST-1',accessToken:'test-private',total:2000}};},accounts:[],enabled:true,model:'test',graphVersion:'v25.0',intentFn:async({text,pending})=>isOrderConfirmation(text,pending?.code)?'confirm':text.includes('Promeni')?'change':'question'});
  const event={id:'facebook:mid-1',conversation:'facebook:123:456',channel:'facebook',account:'123',sender:'456',timestamp:Date.now(),text:'Moze potvrdjujem',attachments:[],echo:false};
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
  if(p.action==='prepare_reclamation')return {ok:true,number:p.number,name:'Pegla',input:p.input,reclamationToken:'new-signed-claim',expiresAt:Date.now()+900000};throw Error('no writes');};
 try {
  await store.pool.query("UPDATE spc_chat_events SET status='skipped'");
  await store.accept({...event,id:'fb:photo',text:'da',attachments:[{type:'image',url:'https://scontent.fbcdn.net/test.jpg'}]});await worker.tick();
  assert.deepEqual(calls.map(c=>c.action),['reclamation_photo','prepare_reclamation']);assert.equal(calls[0].sku,'IRON');
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
  assert.match(state.history.at(-1).content,/nakon isporuke/);
  assert.doesNotMatch(state.history.at(-1).content,/nije kreirana/);
  assert.equal(state.orders.length,1);assert(!state.reclamation);assert(!state.claimStatusNotice);
 }finally{await store.close();}
});
