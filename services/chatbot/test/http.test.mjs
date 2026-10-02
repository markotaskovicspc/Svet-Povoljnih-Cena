import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {createHttpServer} from '../src/server.mjs';
test('staff diagnostics require authentication, scope reads and omit order credentials',async()=>{
 const reads=[];const state={staffOrderCheckFailure:'CONTACT',staffOrder:{eventId:'cmd',status:'creating',quote:{quoteToken:'SECRET'}},staffPlanSummary:{lines:[{sku:'123',qty:1}],guestEmail:'buyer@example.com',shipping:{city:'Belica'}},orders:[{accessToken:'SECRET'}]};
 const store={decode:x=>x,pool:{query:async(sql,args)=>{reads.push({sql,args});return sql.includes('spc_chat_support')?{rows:[{status:'sent',payload:{reason:'CONTACT',transcript:'RAZLOG: CONTACT\n\nPrivate history'}}]}:{rowCount:1,rows:[{state}]};}}};
 const server=await createHttpServer({store,worker:{},accounts:[],adminToken:'operator'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/admin/staff-diagnostics`;
 try{
  assert.equal((await fetch(base+'?id=facebook:123:456')).status,401);assert.equal(reads.length,0);
  const headers={authorization:'Bearer operator'};
  assert.equal((await fetch(base,{headers})).status,400);
  const response=await fetch(base+'?id=facebook:123:456',{headers});assert.equal(response.status,200);
  const body=await response.text();assert.ok(!body.includes('SECRET'));assert.ok(!body.includes('buyer@example.com'));assert.ok(!body.includes('Private history'));
  assert.equal(JSON.parse(body).plan.emailPresent,true);assert.ok(reads.every(r=>r.args[0]==='facebook:123:456'&&r.sql.startsWith('SELECT')));
 }finally{await new Promise(r=>server.close(r));}
});
test('only an authenticated operator can save a verified link for the matching Facebook page',async()=>{
 const state={inboxLink:'legacy'};let saves=0;
 const store={withConversation:async(id,fn)=>fn(id==='facebook:123:456'?{id,channel:'facebook',account:'123'}:null,state,{}),save:async()=>{saves++;}};
 const server=await createHttpServer({store,worker:{},accounts:[],adminToken:'operator'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const link='https://business.facebook.com/latest/inbox/all/?asset_id=123&mailbox_id=123&selected_item_id=789&thread_type=FB_MESSAGE';
 const post=(value,token='operator',id='facebook:123:456')=>fetch(base+'/admin/action',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({id,action:'set_inbox_link',link:value})});
 try{
  assert.equal((await post(link,'wrong')).status,401);
  assert.equal((await post(link.replace('asset_id=123','asset_id=999'))).status,400);
  assert.equal((await post(link,'operator','missing')).status,400);assert.equal(saves,0);
  assert.equal((await post(link)).status,200);assert.equal(saves,1);assert.equal(state.verifiedInboxLink,link);assert.equal(state.inboxLink,undefined);
 }finally{await new Promise(r=>server.close(r));}
});
test('unconfigured Meta connection rejects verification and events while health remains available',async()=>{
  const server=await createHttpServer({store:{pool:{query:async()=>({rows:[]})}},worker:{enabled:false},accounts:[],adminToken:'operator',verifyToken:'verify'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.equal((await fetch(base+'/health')).status,200);
    assert.equal((await fetch(base+'/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=12345')).status,503);
    assert.equal((await fetch(base+'/webhooks/meta',{method:'POST',body:'{}'})).status,503);
  }finally{await new Promise(r=>server.close(r));}
});
test('HTTP webhook verifies raw body, persists before acknowledgement and protects operator API',async()=>{
  const accepted=[];let ticks=0;
  const server=await createHttpServer({store:{pool:{query:async()=>({rows:[]})},accept:async e=>accepted.push(e)},worker:{tick(){ticks++;}},accounts:[{channel:'facebook',id:'123'}],adminToken:'operator',appSecret:'secret',verifyToken:'verify'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.equal((await fetch(base+'/admin/conversations')).status,401);
    assert.equal((await fetch(base+'/admin/conversations',{headers:{authorization:'Bearer operator'}})).status,200);
    const challenge=await fetch(base+'/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=12345');assert.equal(await challenge.text(),'12345');
    assert.equal((await fetch(base+'/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong')).status,403);
    const body=JSON.stringify({object:'page',entry:[{id:'123',messaging:[{sender:{id:'456'},recipient:{id:'123'},timestamp:Date.now(),message:{mid:'mid',text:'Test'}}]}]});
    assert.equal((await fetch(base+'/webhooks/meta',{method:'POST',body})).status,401);assert.equal(accepted.length,0);
    const response=await fetch(base+'/webhooks/meta',{method:'POST',body,headers:{'x-hub-signature-256':'sha256='+createHmac('sha256','secret').update(body).digest('hex')}});
    assert.equal(response.status,200);assert.equal(accepted.length,1);assert.equal(ticks,1);
  }finally{await new Promise(r=>server.close(r));}
});
