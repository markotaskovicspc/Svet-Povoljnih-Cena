export const STAFF_HISTORY_LIMIT=2000;
export function mergeStaffHistory({saved=[],remote=[],local=[],before}){
 const merged=[];
 // Meta's timestamp/order is canonical; stored replies may be a few seconds
 // earlier than their echo. Deduplicate across sources, not within one source.
 for(const source of [remote,local,saved]){
  const previous=merged.slice();
  for(const m of source){
   if(m.timestamp>before||(m.role==='assistant'&&/^Auto-label added:/.test(m.content??'')))continue;
   if(previous.some(p=>p.role===m.role&&p.content===m.content&&Math.abs((p.timestamp??0)-(m.timestamp??0))<10000))continue;
   merged.push(m);
  }
 }
 return merged.sort((a,b)=>(a.timestamp??0)-(b.timestamp??0));
}
