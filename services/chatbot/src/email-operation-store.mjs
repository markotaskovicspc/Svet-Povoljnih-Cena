import {senderKey,sentSummaryMatches,callEmailAction,confirmationIntent,operationReply,operationRecord} from './email-actions.mjs';

export const operationTable=`CREATE TABLE IF NOT EXISTS spc_email_operations(
 id text PRIMARY KEY,sender_hash text NOT NULL,payload text NOT NULL,
 status text NOT NULL DEFAULT 'prepared',decision_id text,result text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());`;

// The caller holds the existing single-worker advisory lock. Persist the decision
// before calling ERP; retries use the same signed token and ERP idempotency key.
export class EmailOperations {
 constructor({c,encode,decode,env,model,call=callEmailAction,classify=confirmationIntent}){Object.assign(this,{c,encode,decode,env,model,call,classify});}
 async execute(row,message){
  let result=row.result?this.decode(row.result):null;
  if(!result){
   const operation=this.decode(row.payload);
   result=await this.call({action:'execute',sender:message.sender,token:operation.token,confirmed:true},this.env);
   await this.c.query("UPDATE spc_email_operations SET status='completed',result=$2,updated_at=now() WHERE id=$1",[row.id,this.encode(result)]);
  }
  return {action:'draft',body:operationReply(result)+'\n\nPodrška | Svet Povoljnih Cena'};
 }
 async recover(id,message){
  const row=(await this.c.query("SELECT * FROM spc_email_operations WHERE decision_id=$1 AND sender_hash=$2 AND status IN ('executing','completed')",[id,senderKey(message.sender)])).rows[0];
  return row?this.execute(row,message):null;
 }
 async respond(id,message,sent){
  if(!message.inReplyTo||!sent)return null;
  const rows=(await this.c.query("SELECT * FROM spc_email_operations WHERE sender_hash=$1 AND status IN ('prepared','executing','completed') ORDER BY created_at DESC LIMIT 30",[senderKey(message.sender)])).rows;
  const row=rows.find(r=>sentSummaryMatches(sent,message,this.decode(r.payload)));
  if(!row)return null;
  if(row.status!=='prepared')return this.execute(row,message);
  const operation=this.decode(row.payload);
  const intent=await this.classify({message,operation,model:this.model});
  if(intent==='confirm'){
   await this.c.query("UPDATE spc_email_operations SET status='executing',decision_id=$2,updated_at=now() WHERE id=$1",[row.id,id]);
   return this.execute(row,message);
  }
  if(intent==='decline'||intent==='change'){
   await this.c.query("UPDATE spc_email_operations SET status=$2,updated_at=now() WHERE id=$1",[row.id,intent==='decline'?'declined':'superseded']);
   if(intent==='decline')return {action:'draft',body:'U redu, radnja iz poslatog sažetka nije izvršena.\n\nPodrška | Svet Povoljnih Cena'};
  }
  return null;
 }
 async existing(id){
  const row=(await this.c.query("SELECT * FROM spc_email_operations WHERE id=$1 AND status='prepared'",[id])).rows[0];
  return row?this.decode(row.payload):null;
 }
 async prepare(id,message,input){
  if(!message.messageId)return {ok:false,error:{code:'MISSING_REPLY_ID'}};
  const existing=await this.existing(id);if(existing)return existing;
  const result=await this.call({...input,sender:message.sender,requestId:id},this.env);
  if(!result.ok||!result.token)return result;
  const operation=operationRecord(result,message);
  await this.c.query('INSERT INTO spc_email_operations(id,sender_hash,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,senderKey(message.sender),this.encode(operation)]);
  return await this.existing(id);
 }
}
