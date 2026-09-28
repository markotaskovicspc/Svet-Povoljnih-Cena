import {tool} from '@openai/agents';
import {z} from 'zod';
import {activeLoyalty} from './loyalty.mjs';
import {normalizePlace} from './delivery.mjs';

function cityWasProvided(city,event,state){
 const words=text=>normalizePlace(text).match(/[a-z]+/g)?.map(w=>w.length>3?w.replace(/(?:om|em|a|u|i|e)$/,''):w)??[];
 const wanted=words(city);
 const sources=[event.text,state.customer?.shipping?.city,...(state.history??[]).filter(m=>m.role==='user').map(m=>m.content)];
 return wanted.length>0&&sources.some(source=>{const tokens=words(source);return tokens.some((_,i)=>wanted.every((w,j)=>tokens[i+j]===w));});
}

export const deliveryQuoteInstructions=`DOSTAVA PRE NARUČIVANJA: Na pitanje koliko je dostava koristi get_delivery_quote čim znaš tačne artikle, količine i mesto u Srbiji. Izvuci ih iz aktuelne prepiske/objave, ne iz stare završene porudžbine. Pitaj samo šta nedostaje; za sam obračun ne traži ime, telefon, ulicu, mejl ili pristanak na kupovinu. Ne pretpostavljaj količinu: ako kupac nije izabrao koliko želi, pitaj. KURIR je podrazumevan; KAMION samo kada kupac izričito traži. shipping je cena dostave cele navedene korpe, ne cena po komadu ili paketu. Navedi kratko na koju količinu/proizvod i mesto se odnosi. Nula znači besplatnu dostavu samo za upravo obračunatu korpu. Ne obećavaj rok, zalihe, cenu robe ili ukupan račun na osnovu ovog alata. Ne množi i ne prepravljaj poštarinu sam. Kad se artikli/količine/mesto ili loyalty status promene, ponovi obračun. pricingBasis=regular znači bez potvrđenog članstva; ne tvrdi da taj iznos već uključuje loyalty. Ne traži mejl samo radi dostave; konačna ponuda ponovo obračunava pogodnosti. Za nejasan artikal prvo katalog/razjašnjenje. Ako alat ne može da izračuna cenu (DELIVERY_PRICE_UNAVAILABLE), kratko reci da tačan iznos treba proveriti, ne izmišljaj cenu i ne koristi staru. To NIJE dokaz da dostava nije moguća: ne tvrdi da kurir ne dostavlja i ne nudi kamion samoinicijativno. Ovaj alat samo čita: ne priprema ponudu za DA i nikad ne kreira porudžbinu.`;

export async function readDeliveryQuote({input,event,state={},spc}){
 if(input.lines.some(line=>!Number.isInteger(line.qty)||line.qty<=0))return {ok:false,error:{code:'DELIVERY_QUANTITY_REQUIRED',message:'Pitaj koliko komada kupac želi. Nikad ne pretpostavljaj jedan komad.'}};
 if(!cityWasProvided(input.city,event,state))return {ok:false,error:{code:'DELIVERY_CITY_REQUIRED',message:'Mesto dostave nije navedeno u prepisci. Pitaj kupca za mesto; ne pretpostavljaj Beograd ili drugi grad.'}};
 const membership=activeLoyalty(state);
 try{
  const result=await spc({action:'delivery_quote',...input,channel:event.channel,conversationId:event.conversation??`comment:${event.id}`,
   ...(membership?{email:membership.email,loyaltyProof:membership.proof}:{})});
  if(!result.ok)return result;
  if(!Number.isFinite(result.shipping)||result.shipping<0)return {ok:false,error:{code:'DELIVERY_PRICE_UNAVAILABLE'}};
  return result;
 }catch{return {ok:false,error:{code:'DELIVERY_PRICE_UNAVAILABLE'}};}
}
export const deliveryQuoteTool=({spc,event,state})=>tool({name:'get_delivery_quote',description:'Proveri cenu dostave CELE korpe. Pre poziva pitaj koliko komada ako kupac nije naveo količinu. Pominjanje naziva u jednini (npr. Urban stolica) NIJE izbor jednog komada. qty=null kada količina nije poznata; NIKAD ne podrazumevaj qty=1. Potrebne su SKU iz kataloga i stvarno mesto kupca. Ne traži lične podatke i ne kreira porudžbinu.',
 parameters:z.object({lines:z.array(z.object({sku:z.string().min(1).max(80),qty:z.number().int().positive().max(99).nullable().describe('Količina koju je kupac naveo za obračun. null ako nije rekao koliko komada, nikad pretpostavljeni 1.')})).min(1).max(50),city:z.string().trim().min(2).max(120),shippingMethod:z.enum(['KURIR','KAMION'])}),
 execute:input=>readDeliveryQuote({input,event,state,spc})});
