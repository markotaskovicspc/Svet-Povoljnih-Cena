import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {createHttpServer} from '../src/server.mjs';
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
