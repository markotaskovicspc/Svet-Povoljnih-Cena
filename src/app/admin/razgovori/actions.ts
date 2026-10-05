'use server';
import {requireAdminAction} from '@/lib/admin';
import {logAudit} from '@/lib/admin/audit';
export async function actOnConversation(input:{id:string,action:'pause'|'resume'|'reply',text?:string,requestId?:string}){
 const actor=await requireAdminAction(['OPS']);
 if(typeof input?.id!=='string'||input.id.length>200||!['pause','resume','reply'].includes(input.action))return {ok:false,message:'Neispravna komanda.'};
 if(input.action==='reply'&&(typeof input.text!=='string'||!input.text.trim()||input.text.length>1800||!/^[0-9a-f-]{36}$/i.test(input.requestId??'')))return {ok:false,message:'Unesite poruku do 1.800 znakova.'};
 const secret=process.env.SOCIAL_INTEGRATION_SECRET;if(!secret||secret.startsWith('GET_FROM_'))return {ok:false,message:'Veza sa chatom nije podešena.'};
 try{
  await logAudit({actorId:actor.id,action:'chat_operator_attempt',entity:'Conversation',entityId:input.id,diff:{action:input.action,requestId:input.requestId}});
  const r=await fetch('https://spc-chatbot-production.up.railway.app/operator/action',{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify({...input,actorId:actor.id}),redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});
  const data=await r.json();const messages:Record<string,string>={BUSY:'Razgovor se trenutno obrađuje. Pokušajte ponovo za nekoliko sekundi.',MESSAGE_WINDOW_CLOSED:'Meta trenutno ne dozvoljava odgovor: prošlo je više od 24 sata od poruke kupca.',RECONCILIATION_REQUIRED:'Najpre treba proveriti ishod porudžbine ili reklamacije u obradi.',MESSAGE_CONFLICT:'Ovaj pokušaj slanja već postoji sa drugim tekstom. Osvežite razgovor.'};
  if(!r.ok||!data.ok)return {ok:false,retrySame:!data.error||r.status>=500,message:messages[data.error]??'Komanda nije izvršena. Osvežite razgovor i proverite stanje.'};
  return {ok:true,message:input.action==='reply'?'Poruka je prihvaćena za slanje. Status vidite u prepisci.':input.action==='pause'?'Preuzeli ste razgovor. Bot je pauziran.':'Bot je ponovo aktivan.'};
 }catch{return {ok:false,retrySame:true,message:'Nije potvrđen ishod. Osvežite razgovor; za ponovno slanje koristite isti pokušaj.'};}
}
