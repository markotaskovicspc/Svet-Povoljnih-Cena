// Graph conversation.link contains a legacy/scoped ID, not Business Suite's
// selected_item_id. Never manufacture an exact thread URL from it or a PSID.
export function verifiedConversationLink(value,accountId){
 try{
  const u=new URL(value);
  if(u.origin!=='https://business.facebook.com'||u.pathname!=='/latest/inbox/all/'||u.username||u.password)return null;
  if(u.searchParams.get('asset_id')!==accountId||u.searchParams.get('mailbox_id')!==accountId||u.searchParams.get('thread_type')!=='FB_MESSAGE'||!/^\d+$/.test(u.searchParams.get('selected_item_id')??''))return null;
  const clean=new URL('https://business.facebook.com/latest/inbox/all/');
  for(const key of ['asset_id','business_id','mailbox_id','selected_item_id','thread_type']){const v=u.searchParams.get(key);if(v)clean.searchParams.set(key,v);}
  return clean.href;
 }catch{return null;}
}
export async function supportInboxContext({account,sender,graphVersion,fetchFn=fetch}){
 if(account?.channel!=='facebook')return {};
 const inbox=new URL('https://business.facebook.com/latest/inbox/all/');
 inbox.searchParams.set('asset_id',account.id);inbox.searchParams.set('mailbox_id',account.id);
 if(account.businessId)inbox.searchParams.set('business_id',account.businessId);
 const result={inboxUrl:inbox.href};
 const url=new URL(`https://graph.facebook.com/${graphVersion}/${account.id}/conversations`);
 url.searchParams.set('user_id',sender);url.searchParams.set('fields','participants');url.searchParams.set('limit','1');
 try{
  const r=await fetchFn(url,{headers:{authorization:`Bearer ${account.token}`},signal:AbortSignal.timeout(7000),redirect:'error'});
  if(r.ok){const person=(await r.json()).data?.[0]?.participants?.data?.find(p=>p.id===sender);
   if(typeof person?.name==='string')result.customerName=person.name.slice(0,150);}
 }catch{ /* Name lookup failure must not prevent the support notification. */ }
 return result;
}
