// Resolve the inbox identity from Meta; a Messenger PSID is not an inbox item ID.
export async function conversationLink({account,sender,graphVersion,fetchFn=fetch}){
 if(account?.channel!=='facebook')return null;
 const url=new URL(`https://graph.facebook.com/${graphVersion}/${account.id}/conversations`);
 url.searchParams.set('user_id',sender);url.searchParams.set('fields','id,link');url.searchParams.set('limit','1');
 const r=await fetchFn(url,{headers:{authorization:`Bearer ${account.token}`},signal:AbortSignal.timeout(7000),redirect:'error'});
 if(!r.ok)return null;
 const link=(await r.json()).data?.[0]?.link;
 if(!link)return null;
 const source=new URL(link,'https://www.facebook.com');
 if(source.origin!=='https://www.facebook.com'||source.username||source.password)return null;
 const item=source.pathname.match(/^\/[^/]+\/inbox\/(\d+)\/?$/)?.[1];
 if(!item)return null;
 const inbox=new URL('https://business.facebook.com/latest/inbox/all/');
 inbox.searchParams.set('asset_id',account.id);inbox.searchParams.set('mailbox_id',account.id);
 inbox.searchParams.set('selected_item_id',item);inbox.searchParams.set('thread_type','FB_MESSAGE');
 return inbox.href;
}
