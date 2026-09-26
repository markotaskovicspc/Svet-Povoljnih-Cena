import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { equal, verifyMeta, parseEvents } from './security.mjs';

export async function createHttpServer({store,worker,accounts,adminToken,appSecret,verifyToken}) {
const page=await readFile(new URL('../public/index.html',import.meta.url));
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/webhooks/meta'&&!appSecret)return reply(503,{error:'Meta connection is not configured'});
    if(url.pathname==='/health'){await store.pool.query('SELECT 1');return reply(200,{ok:true,botEnabled:worker.enabled,accounts:accounts.length});}
    if(req.method==='GET'&&url.pathname==='/webhooks/meta'){
      if(url.searchParams.get('hub.mode')==='subscribe'&&equal(url.searchParams.get('hub.verify_token'),verifyToken)) {res.writeHead(200,{'Content-Type':'text/plain'});return res.end(url.searchParams.get('hub.challenge')??'');}
      return reply(403,{error:'Verification failed'});
    }
    if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"});return res.end(page);}
    const isWebhook=req.method==='POST'&&url.pathname==='/webhooks/meta';
    if(!isWebhook&&!equal(req.headers.authorization,`Bearer ${adminToken}`))return reply(401,{error:'Unauthorized'});
    let bytes=0;const chunks=[];
    for await(const chunk of req){bytes+=chunk.length;if(bytes>256*1024)return reply(413,{error:'Too large'});chunks.push(chunk);}
    const raw=Buffer.concat(chunks);
    if(isWebhook){
      if(!verifyMeta(raw,req.headers['x-hub-signature-256'],appSecret))return reply(401,{error:'Invalid signature'});
      let body;try{body=JSON.parse(raw);}catch{return reply(400,{error:'Invalid JSON'});}
      for(const event of parseEvents(body,accounts))await store.accept(event);
      reply(200,{ok:true});void worker.tick();return;
    }
    if(req.method==='GET'&&url.pathname==='/admin/conversations'){
      const result=await store.pool.query('SELECT id,channel,paused,reason,last_customer,updated_at FROM spc_chat_conversations ORDER BY updated_at DESC LIMIT 100');return reply(200,result.rows);
    }
    if(req.method==='GET'&&url.pathname==='/admin/conversation'){
      const result=await store.pool.query('SELECT state FROM spc_chat_conversations WHERE id=$1',[url.searchParams.get('id')]);
      if(!result.rowCount)return reply(404,{error:'Not found'});
      const state=store.decode(result.rows[0].state);
      const attachments=await store.pool.query('SELECT payload FROM spc_chat_events WHERE conversation=$1 ORDER BY created_at DESC LIMIT 30',[url.searchParams.get('id')]);
      return reply(200,{history:state.history,orders:state.orders.map(o=>({number:o.number})),attachments:attachments.rows.flatMap(e=>store.decode(e.payload).attachments??[])});
    }
    if(req.method==='POST'&&url.pathname==='/admin/action'){
      const body=JSON.parse(raw);if(typeof body.id!=='string'||body.id.length>200)return reply(400,{error:'Invalid conversation'});
      if(body.action==='pause')await store.pause(body.id,'Ručna pauza');
      else if(body.action==='resume')await store.withConversation(body.id,async(_row,state,c)=>{
        if(state.cancelling)throw new Error('Reconcile cancellation before resuming');
        delete state.pending;delete state.reclamation;delete state.handedOff;delete state.cancellation;
        delete state.historyVersion;
        if(state.reclamationInFlight)throw new Error('Reconcile reclamation before resuming');
        await store.save(c,body.id,state);await c.query('UPDATE spc_chat_conversations SET paused=false,reason=NULL WHERE id=$1',[body.id]);
        // Old messages stay handled by the human; do not reply to stale backlog.
        await c.query("UPDATE spc_chat_events SET status='skipped' WHERE conversation=$1 AND status='pending'",[body.id]);
      });
      else if(body.action==='reply'&&typeof body.text==='string'&&body.text.trim()&&body.text.length<=1800)await worker.humanReply(body.id,body.text);
      else return reply(400,{error:'Invalid action'});
      return reply(200,{ok:true});
    }
    return reply(404,{error:'Not found'});
  } catch {if(!res.headersSent)reply(503,{error:'Operation failed; check service configuration or inbox'});else res.end();}
});
server.requestTimeout=15000;server.headersTimeout=10000;
return server;
}
