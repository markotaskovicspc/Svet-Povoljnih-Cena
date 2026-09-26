import test from 'node:test';import assert from 'node:assert/strict';
import {readMetaHistory} from '../src/meta-history.mjs';
test('import reads only same sender/account, excludes current event and sorts older messages',async()=>{
 const msg=(id,from,to,time,message)=>({id,from:{id:from},to:{data:[{id:to}]},created_time:new Date(time).toISOString(),message});
 const messages=[msg('2','page','buyer',2000,'Odgovor'),msg('1','buyer','page',1000,'Pitanje'),msg('wrong','other','page',1500,'Private'),msg('current','buyer','page',3000,'Sada')];
 const got=await readMetaHistory({account:{channel:'facebook',id:'page',token:'synthetic',login:'facebook'},sender:'buyer',before:3000,graphVersion:'v26.0',fetchFn:async(url,opts)=>{
  assert.equal(url.searchParams.get('user_id'),'buyer');assert.equal(opts.redirect,'error');
  return {ok:true,json:async()=>({data:[{messages:{data:messages}}]})};
 }});
 assert.deepEqual(got.map(x=>x.content),['Pitanje','Odgovor']);
});
