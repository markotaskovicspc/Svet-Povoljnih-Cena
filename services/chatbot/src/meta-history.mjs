// Import context only. Historical messages must never become actionable events.
export async function readMetaHistory({account,sender,before,graphVersion,fetchFn=fetch}) {
  if(!account)return [];
  const host=account.login==='instagram'?'graph.instagram.com':'graph.facebook.com';
  const url=new URL(`https://${host}/${graphVersion}/${account.id}/conversations`);
  url.searchParams.set('user_id',sender);
  url.searchParams.set('platform',account.channel==='instagram'?'instagram':'messenger');
  url.searchParams.set('fields','id,messages.limit(100){id,created_time,from,to,message}');
  url.searchParams.set('limit','1');
  const response=await fetchFn(url,{headers:{authorization:`Bearer ${account.token}`},signal:AbortSignal.timeout(7000),redirect:'error'});
  const body=await response.json();
  if(!response.ok)throw Error('META_HISTORY_UNAVAILABLE');
  return (body.data??[]).flatMap(c=>c.messages?.data??[]).flatMap(m=>{
    const from=String(m.from?.id??'');const to=(m.to?.data??[]).map(p=>String(p.id));
    if(!((from===sender&&to.includes(account.id))||(from===account.id&&to.includes(sender))))return [];
    const timestamp=Date.parse(m.created_time);
    if(!Number.isFinite(timestamp)||timestamp>=before||typeof m.message!=='string'||!m.message.trim())return [];
    return [{role:from===sender?'user':'assistant',content:m.message.slice(0,6000),timestamp}];
  }).sort((a,b)=>a.timestamp-b.timestamp).slice(-100);
}
