export function auditWindow(params){
 const from=new Date(params.get('from')),to=new Date(params.get('to'));
 if(!params.get('from')||!params.get('to')||!Number.isFinite(+from)||!Number.isFinite(+to)||to<=from||to-from>48*3600000)throw Error('Invalid audit window');
 let cursor=null;
 if(params.get('cursor')){
  cursor=JSON.parse(Buffer.from(params.get('cursor'),'base64url').toString());
  if(!Array.isArray(cursor)||cursor.length!==3||!Number.isFinite(+new Date(cursor[0]))||!['event','reply'].includes(cursor[1])||typeof cursor[2]!=='string'||cursor[2].length>500)throw Error('Invalid audit cursor');
 }
 return {from,to,cursor};
}

export function redactAuditText(text,customer){
 let result=String(text??'');
 const s=customer?.shipping;
 const known=[customer?.guestEmail,s?.phone,s?.firstName&&s?.lastName?`${s.firstName} ${s.lastName}`:null,s?.street&&s?.houseNumber?`${s.street} ${s.houseNumber}`:null];
 for(const value of known.filter(v=>typeof v==='string'&&v.length>3))result=result.split(value).join('[kontakt]');
 return result.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]')
  .replace(/(?:\+381[\s()/.-]*|\b0)6\d(?:[\s()/.-]*\d){6,8}\b/g,'[telefon]');
}

// Only saved messages and delivery status; never membership proofs, order access
// tokens, attachment URLs or the rest of the encrypted conversation state.
export async function conversationAuditPage(store,window){
 const {from,to,cursor}=window;
 const rows=await store.pool.query(`WITH messages AS (
 SELECT id,conversation,payload,status,created_at,'event' AS kind FROM spc_chat_events WHERE created_at >= $1 AND created_at < $2
 UNION ALL SELECT id,conversation,payload,status,created_at,'reply' AS kind FROM spc_chat_outbox WHERE created_at >= $1 AND created_at < $2
 ) SELECT m.*,m.created_at::text AS cursor_time,c.channel,c.paused,c.reason,c.state FROM messages m JOIN spc_chat_conversations c ON c.id=m.conversation
 WHERE ($3::timestamptz IS NULL OR (m.created_at,m.kind,m.id)>($3::timestamptz,$4::text,$5::text))
 ORDER BY m.created_at,m.kind,m.id LIMIT 101`,[from,to,cursor?.[0]??null,cursor?.[1]??null,cursor?.[2]??null]);
 const page=rows.rows.slice(0,100);
 const records=page.flatMap(r=>{
  const p=store.decode(r.payload),state=store.decode(r.state);
  if(r.kind==='event'&&p.botEcho)return [];
  return [{id:r.id,conversation:r.conversation,channel:r.channel,at:r.created_at,kind:r.kind,
   role:r.kind==='reply'?'bot':p.echo?'staff':'customer',status:r.status,paused:r.paused,pauseReason:r.reason,
   text:redactAuditText(p.text,state.customer),attachments:p.imageUrl?1:(p.attachments?.length??0)}];
 });
 const last=page.at(-1);
 return {records,nextCursor:rows.rows.length>100?Buffer.from(JSON.stringify([last.cursor_time,last.kind,last.id])).toString('base64url'):null};
}
