import test from 'node:test';
import assert from 'node:assert/strict';
import {simpleParser} from 'mailparser';
import {skipMail,compactMail,composeDraft,EmailDraftWorker,draftMessageId} from '../src/email-drafts.mjs';
import {seal,unseal} from '../src/security.mjs';
import {PGlite} from '@electric-sql/pglite';

test('human email remains eligible; notifications, newsletters and own replies are skipped',async()=>{
 for(const [headers,expected] of [['',null],['Auto-Submitted: auto-generated\r\n','automatic'],['List-Id: shop.example\r\n','list'],['X-Spam-Flag: YES\r\n','spam']]){
  const parsed=await simpleParser('From: buyer@example.com\r\nTo: podrska@svetpovoljnihcena.rs\r\n'+headers+'Subject: Porudzbina\r\n\r\nGde je moja porudzbina?');assert.equal(skipMail(parsed),expected);
 }
});
test('draft is a MIME reply to original sender; malicious Reply-To cannot redirect it',async()=>{
 const message=compactMail(await simpleParser('From: buyer@example.com\r\nReply-To: attacker@example.org\r\nMessage-ID: <original@example.com>\r\nSubject: Pitanje\r\n\r\nGde je paket?'));
 const raw=await composeDraft(message,'Poštovani, proverićemo.','synthetic');const draft=await simpleParser(raw);
 assert.equal(draft.to.value[0].address,'buyer@example.com');assert.equal(draft.inReplyTo,'<original@example.com>');assert.equal(draft.messageId,draftMessageId('synthetic'));assert.match(draft.text,/Gde je paket/);assert.equal(draft.headers.get('x-spc-draft'),'human-review-required');
});
function fixture(){
 const key='ab'.repeat(32);const calls=[];
 const worker=new EmailDraftWorker({store:{key,decode:v=>unseal(v,key)},env:{}});
 const c={query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}};
 worker.drafts='Drafts';worker.sent='Sent';
 worker.client={mailboxOpen:async()=>{},search:async()=>[],append:async(...args)=>{calls.push({append:args});}};
 return {worker,c,calls,key};
}
test('prepared draft only uses IMAP APPEND with Draft flag and records success',async()=>{
 const {worker,c,calls,key}=fixture();
 await worker.process(c,{id:'one',status:'prepared',payload:seal({sender:'buyer@example.com'},key),draft:seal({mime:Buffer.from('synthetic MIME').toString('base64')},key)});
 assert.equal(calls.filter(c=>c.append).length,1);assert.deepEqual(calls.find(c=>c.append).append[2],['\\Draft']);assert(calls.some(c=>c.sql?.includes("status='appending'")));assert(calls.some(c=>c.sql?.includes("status='drafted'")));
});
test('uncertain append never blindly duplicates even when draft was moved or deleted',async()=>{
 const {worker,c,calls}=fixture();await worker.process(c,{id:'one',status:'appending'});
 assert(!calls.some(c=>c.append));assert(calls.some(c=>c.sql?.includes('append_outcome_uncertain')));
});
test('lost append response reconciles existing draft',async()=>{
 const {worker,c,calls}=fixture();worker.client.search=async()=>[1];await worker.process(c,{id:'one',status:'appending'});
 assert(!calls.some(c=>c.append));assert(calls.some(c=>c.sql?.includes("status='drafted'")));
});
test('sent human reply suppresses pending draft',async()=>{
 const {worker,c,calls,key}=fixture();worker.client.search=async()=>[1];
 await worker.process(c,{id:'one',status:'pending',payload:seal({messageId:'<source@example.com>'},key)});
 assert(calls.some(c=>c.sql?.includes('already_answered')));assert(!calls.some(c=>c.append));
});
test('first activation skips old inbox; new mail is persisted encrypted once without marking read',async()=>{
 const db=new PGlite();const key='cd'.repeat(32);
 const c={query:async(sql,args)=>args?db.query(sql,args):sql.includes('CREATE TABLE')?(await db.exec(sql),{rows:[]}):db.query(sql)};
 const worker=new EmailDraftWorker({store:{key,pool:c,decode:v=>unseal(v,key)},env:{EMAIL_DRAFTS_ENABLED:'true'}});
 try{
  await worker.start();
  const source=Buffer.from('From: buyer@example.com\r\nSubject: Test\r\n\r\nGde je paket?');
  worker.client={mailbox:{uidValidity:1n,uidNext:11},search:async()=>[10,11],fetchOne:async(_uid,q)=>q.source?{source}:{size:source.length},close(){}};
  await worker.ingest(c);assert.equal((await db.query('SELECT * FROM spc_email_drafts')).rows.length,0);
  worker.client.mailbox.uidNext=12;await worker.ingest(c);await worker.ingest(c);
  const rows=(await db.query('SELECT * FROM spc_email_drafts')).rows;assert.equal(rows.length,1);assert(!rows[0].payload.includes('buyer@example.com'));assert.equal(unseal(rows[0].payload,key).sender,'buyer@example.com');
  worker.client.mailbox.uidValidity=2n;await assert.rejects(()=>worker.ingest(c),/UIDVALIDITY/);
 }finally{await worker.stop();await db.close();}
});
