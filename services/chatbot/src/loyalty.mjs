export function activeLoyalty(state,email){
 const consent=state.loyalty;
 return consent?.proof&&consent.expiresAt>Date.now()&&(!email||consent.email===email.toLowerCase())?consent:null;
}
export async function prepareLoyalty({email,event,state,spc}){
 const supplied=[...state.history.filter(m=>m.role==='user').map(m=>m.content),event.text,state.customer?.guestEmail??''].join('\n').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)??[];
 if(!supplied.some(e=>e.toLowerCase()===email.toLowerCase()))return {ok:false,error:'Najpre traži stvarni mejl kupca.'};
 if(activeLoyalty(state,email))return {ok:true,message:'Loyalty je već aktivan za ovaj mejl. Pripremi ponudu.'};
 const result=await spc({action:'prepare_loyalty',channel:event.channel,conversationId:event.conversation,email});
 if(result.ok){
  delete state.pending;delete state.confirming;delete state.cancellation;delete state.reclamation;
  state.loyaltyPending=result;delete state.loyaltyDeclined;
 }
 return result.ok?{ok:true,message:'Server prikazuje saglasnost. Sačekaj sledeću poruku kupca; ne pripremaj porudžbinu u ovom odgovoru.'}:result;
}
// Consent confirmation is separate from all purchase/cancellation classifiers.
// Ambiguous or changed requests go back to the sales agent without any write.
export async function receiveLoyalty({event,state,spc}){
 const pending=state.loyaltyPending;if(!pending)return null;
 delete state.pending;delete state.confirming;
 const text=event.text.trim().toLowerCase().replace(/[.!]+$/,'').trim();
 if(event.attachments.length||!['da','да','može','moze','може','prihvatam','прихватам','potvrđujem','potvrdjujem','ne','не'].includes(text)){
  delete state.loyaltyPending;return null;
 }
 if(['ne','не'].includes(text)){
  delete state.loyaltyPending;state.loyaltyDeclined=true;
  return 'U redu, nastavljamo bez loyalty članstva. Napišite da pripremim ponudu po redovnim uslovima.';
 }
 const result=await spc({action:'accept_loyalty',channel:event.channel,conversationId:event.conversation,email:pending.email,challenge:pending.challenge});
 delete state.loyaltyPending;
 if(!result.ok)return 'Saglasnost je istekla ili nije prihvaćena. Potrebna je nova loyalty potvrda pre obračuna pogodnosti.';
 state.loyalty={email:result.email,proof:result.proof,expiresAt:result.expiresAt};
 return 'Loyalty pogodnosti su aktivirane. Porudžbina još nije kreirana. Napišite „pripremi ponudu“ da proverimo konačan iznos za izabrane artikle.';
}
