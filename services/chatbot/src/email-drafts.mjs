import {ImapFlow} from 'imapflow';
import {simpleParser} from 'mailparser';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import {createHash} from 'node:crypto';
import {draftEmail,emailContext} from './email-draft-agent.mjs';
import {seal} from './security.mjs';
import {operationReply} from './email-actions.mjs';
import {EmailOperations,operationTable} from './email-operation-store.mjs';

const ADDRESS='podrska@svetpovoljnihcena.rs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function skipMail(mail) {
  const sender=mail.from?.value?.[0]?.address?.toLowerCase();
  if(!sender||mail.from.value.length!==1||sender===ADDRESS)return 'sender';
  const h=mail.headers;
  if(h.get('auto-submitted')&&h.get('auto-submitted')!=='no')return 'automatic';
  if(mail.headerLines?.some(h=>['list-id','list-unsubscribe'].includes(h.key))||h.has('list-id')||h.has('list-unsubscribe')||/bulk|list|junk/i.test(String(h.get('precedence')??'')))return 'list';
  if(/^(no-?reply|mailer-daemon|postmaster)@/i.test(sender))return 'automatic';
  if(/^yes/i.test(String(h.get('x-spam-flag')??'')))return 'spam';
  return null;
}
export function compactMail(mail) {
  return {sender:mail.from?.value?.[0]?.address?.toLowerCase(),to:mail.to?.value?.map(a=>a.address.toLowerCase())??[],subject:String(mail.subject??'').slice(0,300),text:String(mail.text??'').slice(0,24000),messageId:mail.messageId??null,inReplyTo:mail.inReplyTo??null,references:[].concat(mail.references??[],mail.inReplyTo??[]).filter(x=>/^<[^\r\n<>]{1,250}>$/.test(x)).slice(-8),attachments:mail.attachments?.map(a=>String(a.filename??'prilog').slice(0,150)).slice(0,12)??[]};
}
export function draftMessageId(key){return `<spc-draft-${hash(key)}@svetpovoljnihcena.rs>`;}
export async function composeDraft(message,body,key,messageId=draftMessageId(key)) {
  const original=message.text.slice(0,10000).split('\n').map(l=>'> '+l).join('\n');
  return new MailComposer({from:{name:'Podrška | Svet Povoljnih Cena',address:ADDRESS},to:message.sender,
    subject:/^re:/i.test(message.subject)?message.subject:'Re: '+message.subject,
    messageId,inReplyTo:message.messageId||undefined,
    references:[...message.references,...(message.messageId?[message.messageId]:[])],
    headers:{'X-SPC-Draft':'human-review-required'},
    text:body+'\n\n--- Prethodna poruka ---\n'+original,
    disableFileAccess:true,disableUrlAccess:true}).compile().build();
}

export class EmailDraftWorker {
  constructor({store,spc,model,env=process.env}){Object.assign(this,{store,spc,model,env});this.status='disabled';this.busy=false;this.stopped=false;}
  encrypt(value){return seal(value,this.store.key);}
  async start(){
    if(this.env.EMAIL_DRAFTS_ENABLED!=='true')return;
    await this.store.pool.query(`CREATE TABLE IF NOT EXISTS spc_email_cursor(account text PRIMARY KEY,validity text NOT NULL,last_uid bigint NOT NULL);
      CREATE TABLE IF NOT EXISTS spc_email_drafts(id text PRIMARY KEY,uid bigint NOT NULL,validity text NOT NULL,payload text NOT NULL,status text NOT NULL DEFAULT 'pending',attempts int NOT NULL DEFAULT 0,draft text,reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());`);
    this.status=this.env.EMAIL_IMAP_PASSWORD?'connecting':'waiting_for_password';
    await this.store.pool.query(operationTable);
    this.timer=setInterval(()=>void this.tick(),30000);this.timer.unref();void this.tick();
  }
  async connect(){
    if(this.client?.usable)return;
    this.client?.close();
    this.client=new ImapFlow({host:'mail.svetpovoljnihcena.rs',port:993,secure:true,auth:{user:ADDRESS,pass:this.env.EMAIL_IMAP_PASSWORD},logger:false,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:120000,maxIdleTime:60000,tls:{rejectUnauthorized:true}});
    this.client.on('error',()=>{this.status='connection_error';});
    this.client.on('exists',()=>void this.tick());
    this.client.on('close',()=>{if(!this.stopped)this.status='reconnecting';});
    await this.client.connect();
    const boxes=await this.client.list();
    this.drafts=boxes.find(b=>b.specialUse==='\\Drafts')?.path??boxes.find(b=>/^(?:INBOX[./])?(?:Drafts|Nacrti)$/i.test(b.path))?.path;
    this.sent=boxes.find(b=>b.specialUse==='\\Sent')?.path??boxes.find(b=>/^(?:INBOX[./])?(?:Sent|Sent Items|Poslato)$/i.test(b.path))?.path;
    if(!this.drafts)throw Error('EMAIL_DRAFT_FOLDER_NOT_FOUND');
    await this.client.mailboxOpen('INBOX',{readOnly:true});this.status='connected';
  }
  async ingest(c){
    const validity=String(this.client.mailbox.uidValidity);
    let cursor=(await c.query('SELECT * FROM spc_email_cursor WHERE account=$1',[ADDRESS])).rows[0];
    if(!cursor){
      // Explicitly start with future mail; do not turn the old inbox into a draft backlog.
      await c.query('INSERT INTO spc_email_cursor(account,validity,last_uid) VALUES($1,$2,$3)',[ADDRESS,validity,this.client.mailbox.uidNext-1]);return;
    }
    if(cursor.validity!==validity){this.status='uidvalidity_changed';throw Error('EMAIL_UIDVALIDITY_CHANGED');}
    if(this.client.mailbox.uidNext<=Number(cursor.last_uid)+1)return;
    const uids=(await this.client.search({uid:`${Number(cursor.last_uid)+1}:*`},{uid:true})).filter(uid=>uid>Number(cursor.last_uid)).sort((a,b)=>a-b).slice(0,20);
    for(const uid of uids){
      const id=hash(`${ADDRESS}:${validity}:${uid}`);
      const meta=await this.client.fetchOne(uid,{size:true},{uid:true});
      let payload={},reason,status='pending';
      if(!meta){status='skipped';reason='removed';}
      else if(meta.size>10*1024*1024){status='review';reason='message_too_large';}
      else {
        const fetched=await this.client.fetchOne(uid,{source:true},{uid:true});
        if(!fetched?.source)throw Error('EMAIL_FETCH_FAILED');
        const parsed=await simpleParser(fetched.source,{skipHtmlToText:false,skipTextToHtml:true});
        reason=skipMail(parsed);payload=compactMail(parsed);if(reason)status='skipped';
      }
      await c.query('BEGIN');
      try{
        await c.query('INSERT INTO spc_email_drafts(id,uid,validity,payload,status,reason) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[id,uid,validity,this.encrypt(payload),status,reason??null]);
        await c.query('UPDATE spc_email_cursor SET last_uid=$2 WHERE account=$1',[ADDRESS,uid]);await c.query('COMMIT');
      }catch(e){await c.query('ROLLBACK');throw e;}
    }
  }
  async history(message){
    const result=[];
    // Strict reference chain, not every conversation with this customer.
    for(const path of ['INBOX',this.sent].filter(Boolean)){
      await this.client.mailboxOpen(path,{readOnly:true});
      for(const ref of message.references.slice(-5)){
        const ids=await this.client.search({header:{'message-id':ref}},{uid:true});
        for(const uid of ids.slice(-1)){
          const meta=await this.client.fetchOne(uid,{size:true},{uid:true});if(!meta||meta.size>1024*1024)continue;
          const item=await this.client.fetchOne(uid,{source:true},{uid:true});if(!item?.source)continue;
          const parsed=compactMail(await simpleParser(item.source,{skipTextToHtml:true}));
          if(parsed.sender===message.sender||(parsed.sender===ADDRESS&&parsed.to.includes(message.sender)))result.push({...parsed,text:parsed.text.slice(0,8000)});
        }
      }
    }
    return result.slice(-8);
  }
  async sentParent(message){
    if(!this.sent||!/^<[^\r\n<>]{1,250}>$/.test(message.inReplyTo??''))return null;
    await this.client.mailboxOpen(this.sent,{readOnly:true});
    const ids=await this.client.search({header:{'message-id':message.inReplyTo}},{uid:true});
    if(ids.length!==1)return null;
    const meta=await this.client.fetchOne(ids[0],{size:true},{uid:true});
    if(!meta||meta.size>1024*1024)return null;
    const item=await this.client.fetchOne(ids[0],{source:true},{uid:true});
    return item?.source?compactMail(await simpleParser(item.source,{skipTextToHtml:true})):null;
  }
  async reconcile(c,row){
    // APPEND may have committed before a connection loss. Never blindly append again.
    for(const path of [this.drafts,this.sent].filter(Boolean)){
      await this.client.mailboxOpen(path,{readOnly:true});
      const found=await this.client.search({header:{'message-id':row.draft?(this.store.decode(row.draft).messageId??draftMessageId(row.id)):draftMessageId(row.id)}},{uid:true});
      if(found.length){await c.query("UPDATE spc_email_drafts SET status='drafted',draft=NULL,updated_at=now() WHERE id=$1",[row.id]);return;}
    }
    await c.query("UPDATE spc_email_drafts SET status='review',reason='append_outcome_uncertain',updated_at=now() WHERE id=$1",[row.id]);
  }
  async process(c,row){
    if(row.status==='appending')return this.reconcile(c,row);
    const message=this.store.decode(row.payload);
    const operations=this.env.EMAIL_ACTIONS_ENABLED==='true'?new EmailOperations({c,encode:v=>this.encrypt(v),decode:v=>this.store.decode(v),env:this.env,model:this.model}):null;
    const recovered=!row.draft&&operations?await operations.recover(row.id,message):null;
    if(!recovered&&this.sent&&message.messageId){
      await this.client.mailboxOpen(this.sent,{readOnly:true});
      const replied=await this.client.search({header:{'in-reply-to':message.messageId}},{uid:true});
      if(replied.length){await c.query("UPDATE spc_email_drafts SET status='skipped',reason='already_answered',draft=NULL WHERE id=$1",[row.id]);return;}
    }
    let draft=row.draft;
    if(!draft){
      await c.query('UPDATE spc_email_drafts SET attempts=attempts+1 WHERE id=$1',[row.id]);
      const history=await this.history(message);
      const context=await emailContext(message.sender,this.env.SPC_BASE_URL,this.env.SOCIAL_INTEGRATION_SECRET);
      context.loyaltyAccepted=Boolean(operations&&await operations.loyalty(message.sender));
      let result=recovered;
      if(!result&&operations){
        const saved=await operations.existing(row.id);
        if(saved)result={action:'draft',operation:saved};
        else result=await operations.respond(row.id,message,await this.sentParent(message));
      }
      if(!result)result=await draftEmail({message,history,context,spc:this.spc,model:this.model,prepareAction:operations?input=>operations.prepare(row.id,message,input):undefined});
      if(result.operation)result={...result,action:'draft',body:(result.operation.summary??operationReply(result.operation))+'\n\nPodrška | Svet Povoljnih Cena'};
      if(result.action==='skip'){await c.query("UPDATE spc_email_drafts SET status='skipped',reason='no_reply_needed',updated_at=now() WHERE id=$1",[row.id]);return;}
      const messageId=result.operation?.messageId??draftMessageId(row.id);
      draft=this.encrypt({messageId,mime:(await composeDraft(message,result.body,row.id,messageId)).toString('base64')});
      await c.query("UPDATE spc_email_drafts SET status='prepared',draft=$2,updated_at=now() WHERE id=$1",[row.id,draft]);
    }
    await c.query("UPDATE spc_email_drafts SET status='appending',updated_at=now() WHERE id=$1",[row.id]);
    await this.client.append(this.drafts,Buffer.from(this.store.decode(draft).mime,'base64'),['\\Draft']);
    await c.query("UPDATE spc_email_drafts SET status='drafted',draft=NULL,updated_at=now() WHERE id=$1",[row.id]);
    console.log('email.draft_saved');
  }
  async tick(){
    if(this.stopped||this.busy||!this.env.EMAIL_IMAP_PASSWORD)return;
    this.busy=true;let c,locked=false;
    try{
      c=await this.store.pool.connect();locked=(await c.query("SELECT pg_try_advisory_lock(hashtextextended('spc-email-drafts',0)) AS locked")).rows[0].locked;
      if(!locked)return;
      await this.connect();await this.client.mailboxOpen('INBOX',{readOnly:true});await this.ingest(c);
      const rows=(await c.query("SELECT * FROM spc_email_drafts d WHERE (status='pending' AND attempts<3) OR status IN ('prepared','appending') OR (status IN ('pending','review') AND EXISTS (SELECT 1 FROM spc_email_operations o WHERE o.decision_id=d.id AND o.status='executing')) ORDER BY created_at LIMIT 5")).rows;
      for(const row of rows){try{await this.process(c,row);}catch{console.error('email.draft_processing_failed');}}
      await c.query("UPDATE spc_email_drafts SET status='review',reason='processing_failed' WHERE status='pending' AND attempts>=3");
      // Minimize stored customer text once it has been processed; IMAP retains the original.
      await c.query("UPDATE spc_email_drafts SET payload=$1 WHERE status IN ('drafted','skipped') AND created_at < now()-interval '7 days'",[this.encrypt({})]);
      await this.client.mailboxOpen('INBOX',{readOnly:true});this.status='connected';
    }catch(e){this.status=e.message==='EMAIL_UIDVALIDITY_CHANGED'?'uidvalidity_changed':'connection_or_storage_error';console.error('email.worker_unavailable');this.client?.close();}
    finally{if(c){if(locked)await c.query("SELECT pg_advisory_unlock(hashtextextended('spc-email-drafts',0))").catch(()=>{});c.release();}this.busy=false;}
  }
  async stop(){this.stopped=true;clearInterval(this.timer);this.client?.close();while(this.busy)await new Promise(r=>setTimeout(r,100));}
}
