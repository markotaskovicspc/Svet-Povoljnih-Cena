export async function operatorConversations(store,url){
 const offset=Number(url.searchParams.get('offset')??0),channel=url.searchParams.get('channel');
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000||channel&&!['facebook','instagram','web'].includes(channel))throw Error('INVALID_QUERY');
 const result=await store.pool.query('SELECT id,channel,paused,reason,last_customer,updated_at,state,EXISTS(SELECT 1 FROM spc_chat_support s WHERE s.conversation=c.id) AS needs_support FROM spc_chat_conversations c WHERE ($1::text IS NULL OR channel=$1) ORDER BY updated_at DESC,id DESC LIMIT 51 OFFSET $2',[channel||null,offset]);
 const items=result.rows.slice(0,50).map(row=>{const state=store.decode(row.state);return {id:row.id,channel:row.channel,paused:row.paused,reason:row.reason,lastCustomer:Number(row.last_customer),updatedAt:row.updated_at,needsSupport:row.needs_support,name:[state.customer?.shipping?.firstName,state.customer?.shipping?.lastName].filter(Boolean).join(' ')||state.supportCustomerName||null,preview:state.history?.at(-1)?.content?.slice(0,200)||'',inboxLink:state.verifiedInboxLink??null};});
 return {items,nextOffset:result.rows.length>50?offset+50:null};
}
export async function operatorConversation(store,url){
 const id=url.searchParams.get('id'),offset=Number(url.searchParams.get('offset')??0);
 if(!id||id.length>200||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw Error('INVALID_QUERY');
 const found=await store.pool.query('SELECT id,channel,paused,reason,state FROM spc_chat_conversations WHERE id=$1',[id]);
 if(!found.rows.length)return null;const row=found.rows[0],state=store.decode(row.state);
 const result=await store.pool.query(`SELECT id,payload,status,created_at,'event' AS kind FROM spc_chat_events WHERE conversation=$1
 UNION ALL SELECT id,payload,status,created_at,'reply' AS kind FROM spc_chat_outbox WHERE conversation=$1
 ORDER BY created_at DESC,id DESC LIMIT 101 OFFSET $2`,[id,offset]);
 const history=result.rows.slice(0,100).flatMap(item=>{const p=store.decode(item.payload);if(item.kind==='event'&&(p.botEcho||p.referralOnly))return [];return [{id:item.id,source:item.kind==='reply'?(p.human?'Zaposleni':'Bot'):p.echo?'Zaposleni':'Kupac',status:item.status,timestamp:p.timestamp||new Date(item.created_at).getTime(),text:p.text||(p.imageUrl?'[Slika proizvoda]':p.attachments?.length?'[Prilog kupca]':''),attachments:[...(p.attachments??[]),...(p.imageUrl?[{url:p.imageUrl}]:[])].flatMap(a=>typeof a.url==='string'&&a.url.startsWith('https://')?[{url:a.url}]:[])}];});
 const support=await store.pool.query('SELECT id,payload,status,created_at FROM spc_chat_support WHERE conversation=$1 ORDER BY created_at DESC LIMIT 30',[id]);
 return {id,channel:row.channel,paused:row.paused,reason:row.reason,name:[state.customer?.shipping?.firstName,state.customer?.shipping?.lastName].filter(Boolean).join(' ')||state.supportCustomerName||null,history:history.reverse(),context:offset===0?(state.history??[]):[],orders:(state.orders??[]).map(o=>({number:o.number})),support:support.rows.map(s=>({id:s.id,status:s.status,reason:store.decode(s.payload).reason,at:s.created_at})),nextOffset:result.rows.length>100?offset+100:null};
}


