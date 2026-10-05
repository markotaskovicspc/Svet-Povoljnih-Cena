import {inWindow} from './security.mjs';
import {isOrderCommandText} from './staff-order.mjs';
export async function operatorAction({store,worker,body}){
 if(typeof body?.id!=='string'||body.id.length>200||!['pause','resume','reply'].includes(body.action))return {status:400,data:{error:'INVALID_ACTION'}};
 if(body.action==='reply'&&(typeof body.text!=='string'||!body.text.trim()||body.text.length>1800||!/^[0-9a-f-]{36}$/i.test(body.requestId??'')))return {status:400,data:{error:'INVALID_MESSAGE'}};
 const exists=await store.pool.query('SELECT id FROM spc_chat_conversations WHERE id=$1',[body.id]);if(!exists.rows.length)return {status:404,data:{error:'NOT_FOUND'}};
 let result={status:409,data:{error:'BUSY'}};
 await store.withConversation(body.id,async(row,state,c)=>{
  const outId='operator:'+body.id+':'+body.requestId;
  const command=body.action==='reply'&&isOrderCommandText(body.text);
  if(body.action==='reply'){
   const prior=await c.query('SELECT payload,status FROM spc_chat_events WHERE id=$1 AND conversation=$2',[outId,row.id]);
   if(prior.rows.length){result=command&&store.decode(prior.rows[0].payload).text===body.text.trim()?{status:200,data:{ok:true,command:true,messageId:outId,delivery:prior.rows[0].status}}:{status:409,data:{error:'MESSAGE_CONFLICT'}};return;}
   const sent=await c.query('SELECT payload,status FROM spc_chat_outbox WHERE id=$1 AND conversation=$2',[outId,row.id]);
   if(sent.rows.length){const prior=store.decode(sent.rows[0].payload);result=prior.text===body.text.trim()?{status:200,data:{ok:true,messageId:outId,delivery:sent.rows[0].status}}:{status:409,data:{error:'MESSAGE_CONFLICT'}};return;}
   if(row.channel!=='web'&&!inWindow(Number(row.last_customer))){result={status:409,data:{error:'MESSAGE_WINDOW_CLOSED'}};return;}
  }
  if(body.action==='resume'&&(state.confirming||state.cancelling||state.submittingReclamation||state.reclamationInFlight||state.operatorOrder||state.staffOrder?.status==='creating')){result={status:409,data:{error:'RECONCILIATION_REQUIRED'}};return;}
  await c.query('BEGIN');
  try{
   if(body.action==='resume'){
    delete state.pending;delete state.reclamation;delete state.cancellation;delete state.handedOff;delete state.historyVersion;
    await c.query("UPDATE spc_chat_events SET status='skipped' WHERE conversation=$1 AND status='pending'",[row.id]);
    // Resume only the latest unanswered customer message, never the whole backlog.
    // Delivered staff/bot replies and later order commands count as an answer.
    const recent=await c.query("SELECT id,payload,created_at,'event' AS kind FROM spc_chat_events WHERE conversation=$1 UNION ALL SELECT id,payload,created_at,'reply' AS kind FROM spc_chat_outbox WHERE conversation=$1 AND status IN ('sent','sending','uncertain') ORDER BY created_at DESC LIMIT 30",[row.id]);
    const latest=recent.rows.find(item=>{const p=store.decode(item.payload);return !p.botEcho&&!p.referralOnly;});
    if(latest?.kind==='event'){
     const p=store.decode(latest.payload);
     if(!p.echo&&inWindow(p.timestamp)){
      state.history=await store.history(c,row.id,{id:latest.id,timestamp:Date.now()});
      await c.query("UPDATE spc_chat_events SET status='pending',next_at=now(),attempts=0 WHERE id=$1 AND status='skipped'",[latest.id]);
     }
    }
    await c.query('UPDATE spc_chat_conversations SET paused=false,reason=NULL WHERE id=$1',[row.id]);
   }else{
    delete state.handedOff;
    await c.query('UPDATE spc_chat_conversations SET paused=true,reason=$2 WHERE id=$1',[row.id,'Razgovor preuzeo zaposleni']);
    const queued=await c.query("SELECT id,payload FROM spc_chat_outbox WHERE conversation=$1 AND status='pending'",[row.id]);
    for(const item of queued.rows){const p=store.decode(item.payload);if(!p.human&&!p.staffCommand)await c.query("UPDATE spc_chat_outbox SET status='suppressed' WHERE id=$1",[item.id]);}
    if(body.action==='reply'){
     const text=body.text.trim();
     if(command){
      const event={id:outId,conversation:row.id,channel:row.channel,account:row.account,sender:row.sender,text,echo:true,operatorCommand:true,actorId:body.actorId,timestamp:Date.now()};
      await c.query('INSERT INTO spc_chat_events(id,conversation,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[outId,row.id,store.encode(event)]);
     }else{
      state.history??=[];state.history.push({role:'assistant',content:text,timestamp:Date.now()});
      await store.enqueue(c,outId,row.id,{text,human:true,operator:true,actorId:body.actorId});
     }
    }
   }
   await store.save(c,row.id,state);await c.query('COMMIT');result={status:200,data:{ok:true,...(body.action==='reply'?{messageId:outId,delivery:'pending',command}:{})}};
  }catch(e){await c.query('ROLLBACK');throw e;}
 });
 if(result.status===200)void worker.tick();return result;
}
