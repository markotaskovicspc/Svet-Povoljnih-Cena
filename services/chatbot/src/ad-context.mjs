import {PostVisionReader,postMedia} from './post-vision.mjs';
const reader=new PostVisionReader();
// Accept only the bounded referral metadata from the signed Meta webhook.
export function adReferral(event){
 const r=event.referral??event.message?.referral??event.postback?.referral;
 if(r?.source!=='ADS')return null;
 const d=r.ads_context_data??{};
 return {adId:String(r.ad_id??'').slice(0,100),title:String(d.ad_title??'').slice(0,1500),postId:/^\d+(?:_\d+)?$/.test(String(d.post_id??''))?String(d.post_id):null,photoUrl:typeof d.photo_url==='string'?d.photo_url.slice(0,3000):null};
}
export async function receiveAdContext({state,event,account,graphVersion,model,fetchFn=fetch,vision=reader}){
 if(!event.referral||Number(state.adOrigin?.createdAt)>event.timestamp)return;
 const r=event.referral;
 if(state.adOrigin?.eventId===event.id)return;
 let data={full_picture:r.photoUrl};
 if(r.postId&&account){
  try{
   const url=new URL(`https://graph.facebook.com/${graphVersion}/${r.postId}`);
   url.searchParams.set('fields','message,full_picture,attachments{title,description,media,type}');
   const response=await fetchFn(url,{headers:{authorization:`Bearer ${account.token}`},signal:AbortSignal.timeout(7000),redirect:'error'});
   if(response.ok)data={...data,...await response.json()};
  }catch{/* Referral title/image still provides context without post permissions. */}
 }
 let visual=null;
 try{visual=await vision.read(postMedia(data,'facebook'),model);}catch{}
 state.adOrigin={eventId:event.id,adId:r.adId,postId:r.postId,title:r.title,text:String(data.message??'').slice(0,4000),visual,createdAt:event.timestamp};
}
