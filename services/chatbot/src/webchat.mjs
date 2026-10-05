import {equal} from './security.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function webchat({req,url,reply,store,worker,secret}){
 if(!secret||!equal(req.headers.authorization,`Bearer ${secret}`))return reply(401,{error:'Unauthorized'});
 const session=url.searchParams.get('session');
 if(!uuid.test(session??''))return reply(400,{error:'Invalid session'});
 const conversation=`web:spc:${session}`;
 if(req.method==='POST'){
  if(!worker.enabled)return reply(503,{error:'Chat unavailable'});
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192)return reply(413,{error:'Too large'});}
  let body;try{body=JSON.parse(raw);}catch{return reply(400,{error:'Invalid JSON'});}
  if(!uuid.test(body?.id??'')||typeof body.text!=='string'||!body.text.trim()||body.text.length>2000)return reply(400,{error:'Invalid message'});
  const count=await store.pool.query("SELECT count(*)::int AS n FROM spc_chat_events WHERE conversation=$1 AND created_at>now()-interval '1 minute'",[conversation]);
  if(count.rows[0].n>=15)return reply(429,{error:'Too many messages'});
  await store.accept({id:`web:${session}:${body.id}`,conversation,channel:'web',account:'spc',sender:session,text:body.text.trim(),attachments:[],timestamp:Date.now(),echo:false});
  reply(202,{ok:true});void worker.tick();return;
 }
 if(req.method!=='GET')return reply(405,{error:'Method not allowed'});
 const rows=await store.pool.query(`SELECT * FROM (SELECT id,payload,status,created_at,'user' AS role FROM spc_chat_events WHERE conversation=$1
 UNION ALL SELECT id,payload,status,created_at,'assistant' AS role FROM spc_chat_outbox WHERE conversation=$1 AND status='sent'
 ORDER BY created_at DESC,id DESC LIMIT 100) recent ORDER BY created_at,id`,[conversation]);
 const messages=rows.rows.map(r=>{const p=store.decode(r.payload);return {id:r.id,role:r.role,text:p.text??'',imageUrl:p.imageUrl??null,status:r.status};});
 const state=await store.pool.query('SELECT paused FROM spc_chat_conversations WHERE id=$1',[conversation]);
 return reply(200,{messages,needsSupport:Boolean(state.rows[0]?.paused)});
}
