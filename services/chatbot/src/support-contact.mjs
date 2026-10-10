import {z} from 'zod';
const emailSchema=z.email();
const normalize=text=>String(text??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'dj');
export function customerEmail(text){
 return (String(text??'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)??[]).find(value=>emailSchema.safeParse(value).success)?.toLowerCase()??null;
}
export function wantsHuman(text){
 const t=normalize(text);
 if(/ne (?:zelim|treba mi|trazim) (?:coveka|operatera|kolegu|podrsku)/.test(t))return false;
 return /(?:prav[auoe]+ (?:osob|podrsk)|pomoc prave osobe|(?:zelim|hocu|trazim|treba mi|potrebna mi je|dajte mi|spojite me|razgovaram sa).{0,40}(?:covek|coveka|osob|operater|koleg|zaposlen)|(?:human|real person|live agent)|(?:стварн|прав).{0,15}(?:особ|подршк)|(?:желим|хоћу|треба ми).{0,30}(?:човек|оператер))/.test(t);
}
export function requestSupportContact({state,event}){
 if(state.supportContact?.email||state.supportContact?.declined||state.supportContact?.askedAt)return null;
 const email=customerEmail(event.text)||state.customer?.guestEmail||[...(state.history??[])].reverse().filter(m=>m.role==='user').map(m=>customerEmail(m.content)).find(Boolean);
 if(email&&emailSchema.safeParse(email).success){
  state.supportContact={email:email.toLowerCase()};
  return null;
 }
 state.supportContact={askedAt:Date.now(),waiting:true};
 return 'Ako želite odgovor mejlom, na koju adresu korisnička podrška može da Vam se javi? Možete nastaviti i ovde u razgovoru.';
}
export function receiveSupportContact({state,event}){
 // Do not interrupt reconciliation of an ERP write with an ordinary lead flow.
 if(state.confirming||state.cancelling||state.submittingReclamation||state.reclamationInFlight||state.operatorOrder)return null;
 if(state.supportContact?.waiting){
  const email=customerEmail(event.text);
  if(email){
   state.supportContact={...state.supportContact,email,waiting:false};
   state.supportRequest={reason:state.lastSupportRequest?.reason??'Kupac traži pomoć zaposlenog',contactUpdate:true};
   return 'Hvala, zabeležio sam mejl uz Vaš upit za korisničku podršku. Odgovor možete dobiti na toj adresi.';
  }
  if(/^(?:ne|не|ne zelim|ne bih|ne hvala|necu)[.!\s]*$|ne (?:zelim|dajem|bih|mogu).{0,30}(?:mejl|email|adres)|nemam (?:mejl|email)|bez (?:mejla|emaila)/.test(normalize(event.text))){
   state.supportContact={...state.supportContact,waiting:false,declined:true};
   return 'U redu, mejl nije obavezan. Upit ostaje zabeležen za korisničku podršku, a odgovor možete proveriti ovde u razgovoru.';
  }
 }
 if(!wantsHuman(event.text))return null;
 delete state.pending;delete state.loyaltyPending;delete state.cancellation;delete state.reclamation;
 if(!state.lastSupportRequest)state.supportRequest={reason:'Kupac izričito traži pomoć zaposlenog: '+event.text.slice(0,140)};
 return requestSupportContact({state,event})??'Razumem. Upit je zabeležen za korisničku podršku; odgovor možete proveriti ovde u razgovoru.';
}

// The worker owns the optional callback question. Remove only duplicate email
// questions from model prose, keeping the actual answer and other questions.
export function appendSupportContact(message,question){
 if(!question)return message;
 const sentences=String(message??'').split(/(?<=[.!?])\s+/);
 const answer=sentences.filter(s=>!(/\?/.test(s)&&/(?:mejl|email|e-mail)/i.test(s))).join(' ').trim();
 return [answer,question].filter(Boolean).join('\n\n');
}
