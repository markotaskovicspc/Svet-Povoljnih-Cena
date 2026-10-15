import {normalizePlace} from './delivery.mjs';
export function activeLoyalty(state,email){
 const consent=state.loyalty;
 return consent?.proof&&consent.expiresAt>Date.now()&&(!consent.email||!email||consent.email===email.toLowerCase())?consent:null;
}
export async function prepareLoyalty({email=null,event,state,spc}){
 const supplied=[...state.history.filter(m=>m.role==='user').map(m=>m.content),event.text,state.customer?.guestEmail??''].join('\n').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)??[];
 if(email&&!supplied.some(e=>e.toLowerCase()===email.toLowerCase()))return {ok:false,error:'Koristi samo mejl koji je kupac stvarno dostavio ili null.'};
 if(activeLoyalty(state,email))return {ok:true,message:'Loyalty je već aktivan u ovom razgovoru. Pripremi ponudu.'};
 if(state.loyaltyPending&&(!state.loyaltyPending.expiresAt||state.loyaltyPending.expiresAt>Date.now())&&(state.loyaltyPending.email??null)===(email??null))return {ok:true,message:'Saglasnost je već prikazana i čeka odgovor. Odgovori na kupčevo pitanje; ne šalji ponovo uslove i ne pripremaj novu saglasnost.'};
 const result=await spc({action:'prepare_loyalty',channel:event.channel,conversationId:event.conversation,email});
 if(result.ok){
  delete state.pending;delete state.confirming;delete state.cancellation;delete state.reclamation;
  state.loyaltyPending={...result,preparedEventId:event.id??null};delete state.loyaltyDeclined;
 }
 return result.ok?{ok:true,message:'Server prikazuje saglasnost. Sačekaj sledeću poruku kupca; ne pripremaj porudžbinu u ovom odgovoru.'}:result;
}
// Consent confirmation is separate from all purchase/cancellation classifiers.
// Ambiguous or changed requests go back to the sales agent without any write.
export async function receiveLoyalty({event,state,spc}){
 const pending=state.loyaltyPending;if(!pending)return null;
 delete state.pending;delete state.confirming;
 const text=normalizePlace(event.text).replace(/[.!]+$/,'').trim();
 if(/\b(?:promen\w*|drugi|novi)\b.*\b(?:mejl|email|adresu)\b/.test(text)){
  delete state.loyaltyPending;return null;
 }
 const negative=/\b(?:ne|necu|nisam|ali|ako|mozda|li|promen\w*|koliko|kako|zasto|otkaz\w*|reklam\w*|porudzbin\w*)\b|[?>]/.test(text);
 const accepted=!negative&&(/^(?:da|moze)(?:[,\s]+hvala)?$/.test(text)||/^(?:prihvatam|potvrdjujem)(?:$|[,\s])/.test(text));
 const declined=/^ne(?:[,\s]+hvala)?$/.test(text);
 if(event.attachments.length||(!accepted&&!declined)){
  // Questions and attachments are not consent, but must not discard the
  // challenge whose terms the buyer has already read.
  pending.preparedEventId??='previous-consent';return null;
 }
 if(declined){
  delete state.loyaltyPending;state.loyaltyDeclined=true;
  return 'U redu, nastavljamo bez loyalty članstva. Napišite da pripremim ponudu po redovnim uslovima.';
 }
 const result=await spc({action:'accept_loyalty',channel:event.channel,conversationId:event.conversation,email:pending.email,challenge:pending.challenge});
 delete state.loyaltyPending;
 if(!result.ok)return 'Saglasnost je istekla ili nije prihvaćena. Potrebna je nova loyalty potvrda pre obračuna pogodnosti.';
 state.loyalty={email:result.email,proof:result.proof,expiresAt:result.expiresAt};
 return 'Loyalty je aktiviran. Da pripremim ponudu? Odgovorite DA. Porudžbina još nije kreirana.';
}
