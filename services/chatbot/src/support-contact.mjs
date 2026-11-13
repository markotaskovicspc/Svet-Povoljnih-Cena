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
// Client request (13.11.2026): never ask for a callback email on any channel —
// customer support answers in the same conversation.
export function requestSupportContact({state}){
 if(state.supportContact?.waiting)state.supportContact={...state.supportContact,waiting:false};
 return null;
}
export function receiveSupportContact({state,event}){
 // Old conversations may still be waiting for the former callback question.
 if(state.supportContact?.waiting)state.supportContact={...state.supportContact,waiting:false};
 // Do not interrupt reconciliation of an ERP write with an ordinary lead flow.
 if(state.confirming||state.cancelling||state.submittingReclamation||state.reclamationInFlight||state.operatorOrder)return null;
 if(!wantsHuman(event.text))return null;
 delete state.pending;delete state.loyaltyPending;delete state.cancellation;delete state.reclamation;
 if(!state.lastSupportRequest)state.supportRequest={reason:'Kupac izričito traži pomoć zaposlenog: '+event.text.slice(0,140)};
 return 'Razumem. Upit je zabeležen za korisničku podršku; odgovor možete proveriti ovde u razgovoru.';
}

// The worker owns the optional callback question. Remove only duplicate email
// questions from model prose, keeping the actual answer and other questions.
export function appendSupportContact(message,question){
 const sentences=String(message??'').split(/(?<=[.!?])\s+/);
 const kept=sentences.filter(s=>{
  const text=normalize(s);
  const email=/(?:mejl|e-?mail|e-post)/.test(text);
  const request=/\?/.test(s)||/(?:posaljite|napisite|navedite|dostavite|ostavite)[^.!?\n]{0,80}(?:mejl|e-?mail|e-post)/.test(text);
  return !(email&&request);
 });
 if(!question&&kept.length===sentences.length&&String(message??'').trim())return message;
 const answer=kept.join(' ').trim();
 return [answer,question].filter(Boolean).join('\n\n')||'Prosledio sam Vaš upit korisničkoj podršci. Odgovor možete proveriti ovde u razgovoru.';
}

export function guardSupportContact({text,state}){
 if(!(state.supportRequest||state.lastSupportRequest)||state.claimVerification||state.reclamation||state.loyaltyPending)return text;
 return appendSupportContact(text,null);
}
