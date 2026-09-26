import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {seal,unseal} from '../src/security.mjs';
import {latestEmailText,sentSummaryMatches} from '../src/email-actions.mjs';
import {EmailOperations,operationTable} from '../src/email-operation-store.mjs';

const source={sender:'buyer@example.com',messageId:'<original@example.com>'};
const message={...source,messageId:'<reply@example.com>',inReplyTo:'<outlook-changed@example.com>',text:'Da, otkažite'};
const sent={sender:'podrska@svetpovoljnihcena.rs',to:[source.sender],messageId:message.inReplyTo,inReplyTo:source.messageId,text:'Tačan sažetak\n\nPodrška | Svet Povoljnih Cena'};
test('only an actual sent, unchanged summary for this sender and parent can authorize',()=>{
 const op={sourceMessageId:source.messageId,summary:'Tačan sažetak'};
 assert(sentSummaryMatches(sent,message,op));
 for(const changed of [{sender:'attacker@example.com'},{to:['other@example.com']},{inReplyTo:'<other@example.com>'},{messageId:'<draft@example.com>'},{text:'Izmenjen sažetak'}])assert(!sentSummaryMatches({...sent,...changed},message,op));
 assert(!sentSummaryMatches(sent,{...message,sender:'other@example.com'},op));
});
test('quoted confirmation is excluded from intent input',()=>{
 assert.equal(latestEmailText('Ne, sačekajte\n\nOn Friday customer wrote:\nDa, potvrđujem'),'Ne, sačekajte');
 assert.equal(latestEmailText('> Potvrđujem'),'');
});
test('sent loyalty consent activates separately; only same sender gets proof on later purchase',async()=>{
 const db=new PGlite();await db.exec(operationTable);const calls=[];
 const ops=new EmailOperations({c:db,encode:JSON.stringify,decode:JSON.parse,env:{},classify:async()=> 'confirm',call:async input=>{
  calls.push(input);
  if(input.action==='execute')return {ok:true,kind:'loyalty',proof:'private-proof',expiresAt:Date.now()+60000};
  return {ok:true,kind:input.action==='prepare_loyalty'?'loyalty':'purchase',token:'signed',summary:'Tačan sažetak'};
 }});
 try{
  await ops.prepare('l'.repeat(64),source,{action:'prepare_loyalty'});
  assert.equal(await ops.loyalty(source.sender),null);
  const reply=await ops.respond('r'.repeat(64),{...message,text:'DA'},sent);
  assert.match(reply.body,/Porudžbina još nije kreirana/);
  assert.equal(calls.filter(c=>c.action==='execute').length,1);
  await ops.prepare('p'.repeat(64),source,{action:'prepare_purchase',input:{}});
  assert.equal(calls.at(-1).loyaltyProof,'private-proof');
  await ops.prepare('q'.repeat(64),{...source,sender:'other@example.com'},{action:'prepare_purchase',input:{}});
  assert.equal(calls.at(-1).loyaltyProof,undefined);
 }finally{await db.close();}
});
test('unsent drafts do nothing; durable confirmation retries same token and receipt without duplicate actions',async()=>{
 const db=new PGlite();await db.exec(operationTable);const key='ab'.repeat(32);
 let calls=0;const seen=[];
 const opts={c:db,encode:v=>seal(v,key),decode:v=>unseal(v,key),env:{},classify:async()=> 'confirm',call:async p=>{
  if(p.action!=='execute')return {ok:true,kind:'cancel',token:'fixed-token',summary:'Tačan sažetak'};
  seen.push(p.token);calls++;if(calls===1)throw Error('lost response');return {ok:true,kind:'cancel',number:'TEST-1'};
 }};
 try{
  const ops=new EmailOperations(opts);await ops.prepare('a'.repeat(64),source,{action:'prepare_cancel',number:'TEST-1'});
  assert.equal(await ops.respond('b'.repeat(64),message,null),null);assert.equal(calls,0);
  await assert.rejects(()=>ops.respond('b'.repeat(64),message,sent),/lost response/);
  assert.equal((await db.query('SELECT status FROM spc_email_operations')).rows[0].status,'executing');
  const restarted=new EmailOperations(opts);assert.match((await restarted.recover('b'.repeat(64),message)).body,/TEST-1/);
  assert.match((await restarted.recover('b'.repeat(64),message)).body,/otkazana/);
  assert.deepEqual(seen,['fixed-token','fixed-token']);
  assert.equal(await restarted.recover('b'.repeat(64),{...message,sender:'other@example.com'}),null);
 }finally{await db.close();}
});
test('a change supersedes old confirmation and cannot execute on later bare yes',async()=>{
 const db=new PGlite();await db.exec(operationTable);let executions=0;
 const ops=new EmailOperations({c:db,encode:JSON.stringify,decode:JSON.parse,env:{},classify:async()=> 'change',call:async p=>{if(p.action==='execute')executions++;return {ok:true,kind:'purchase',token:'token',summary:'Tačan sažetak'};}});
 try{
  await ops.prepare('a'.repeat(64),source,{action:'prepare_purchase'});
  assert.equal(await ops.respond('b'.repeat(64),message,sent),null);
  assert.equal(await ops.respond('c'.repeat(64),message,sent),null);assert.equal(executions,0);
 }finally{await db.close();}
});
