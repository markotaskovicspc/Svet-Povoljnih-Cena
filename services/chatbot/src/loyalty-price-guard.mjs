import {activeLoyalty,prepareLoyalty} from './loyalty.mjs';

// A missing membership proof must not silently turn the advertised member offer
// into a full-price checkout. Only the separate, recorded refusal opts out.
export async function guardLoyaltyPrice({input,products,state,event,spc}){
 const discounted=products.filter(p=>p.loyaltyPrice>0&&p.loyaltyPrice<p.price);
 if(!discounted.length||state.loyaltyDeclined)return {ok:true,required:false};
 if(input.guestEmail&&activeLoyalty(state,input.guestEmail))return {ok:true,required:true};
 delete state.pending;delete state.confirming;
 if(input.guestEmail){
  const consent=await prepareLoyalty({email:input.guestEmail,event,state,spc});
  if(!consent.ok)state.supportRequest={reason:'Loyalty saglasnost nije dostupna; proveriti ponuđenu cenu'};
  return {ok:false,code:'LOYALTY_CONFIRMATION_PENDING',message:consent.ok?'Za ponuđenu loyalty cenu server sada prikazuje posebnu saglasnost. Sačekaj DA, ne pripremaj skuplju ponudu.':'Loyalty potvrda nije dostupna. Ne menjaj ponuđenu cenu; prosledi proveru kolegi.'};
 }
 state.supportRequest={reason:'Kupovina bez mejla: proveriti ponuđenu loyalty cenu za '+discounted.map(p=>p.sku).join(', ')};
 return {ok:false,code:'LOYALTY_IDENTITY_REVIEW',message:'Možemo da nastavimo bez mejla. Kolega će proveriti kako da zadržimo ponuđenu loyalty cenu; ne pravim skuplju porudžbinu.'};
}

export function loyaltyQuoteMatches(result,required){
 return !result.ok||!required||result.loyaltyApplied===true;
}
