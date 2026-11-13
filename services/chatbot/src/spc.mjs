import { selectTown,resolveQualifiedTown } from './delivery.mjs';
import { resolveLooseTown } from './locality.mjs';
import { signRequest } from './security.mjs';
export function createSpcClient(base, secret) {
  const url = new URL('/api/integrations/social',base);
  if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('SPC_HTTPS_REQUIRED');
  return async payload => {
    if(payload.action==='quote'||payload.action==='staff_quote') {
      const supplied=payload.input.shipping;
      // Formatting only: 033 is the same building as 33. Keep suffixes and
      // slash-separated address components; never guess a missing number.
      const rawPostal=String(supplied.postalCode??'').trim();
      // Invalid optional postal text must not reach the ERP schema. Resolve the
      // real locality instead; keep valid buyer-supplied five-digit corrections.
      const shipping={...supplied,postalCode:/^\d{5}$/.test(rawPostal)?rawPostal:null,houseNumber:typeof supplied.houseNumber==='string'?houseNumberForErp(supplied.houseNumber):supplied.houseNumber};
      // ERP rejects such numbers with HTTP 400; ask the buyer instead of handing off.
      if(typeof shipping.houseNumber==='string'&&/\D/.test(shipping.houseNumber)&&!validHouseNumber(shipping.houseNumber))return {ok:false,error:{code:'HOUSE_NUMBER_INVALID',message:'Pitaj kupca samo za kućni broj (npr. 12, 12A, 12/3 ili bb). Stan, sprat i ulaz nisu kućni broj. Ostale podatke ne traži ponovo.'}};
      const lookup=async query=>{
        const url=new URL('/api/x-express/locations',base);
        url.searchParams.set('q',query);url.searchParams.set('limit','20');
        const response=await fetch(url,{signal:AbortSignal.timeout(12000),redirect:'error'});
        if(!response.ok)throw new Error('SPC_DELIVERY_LOOKUP_FAILED');
        return (await response.json()).items??[];
      };
      let items=await lookup(shipping.postalCode?.trim()||shipping.city);
      let town=selectTown(items,shipping);
      // A buyer's postal code is optional and may denote the nearby post office.
      // Resolve a unique exact locality independently; never pick an unrelated
      // town merely because it shares the supplied postal code.
      if(!town&&shipping.postalCode?.trim()){
        items=await lookup(shipping.city);
        town=selectTown(items,{...shipping,postalCode:null});
      }
      if(!town)town=await resolveQualifiedTown(shipping.city,lookup);
      // Last resort: genitive/suffix forms, "opština", Belgrade boroughs and
      // neighbourhoods, unknown suburb of a known town. Unique records only.
      let loose=null;
      if(!town){loose=await resolveLooseTown(shipping,lookup);town=loose.town;}
      if(!town) return {ok:false,error:{code:'DELIVERY_ADDRESS_INVALID',message:'Pitaj samo za tačno naselje/opštinu da razjasniš mesto. Sačuvaj poštanski broj koji je kupac naveo; ako ga nije naveo, popunjava ga sistem. Ne izmišljaj ga i ne biraj proizvoljno među istoimenim mestima.',candidates:(loose?.candidates?.length?loose.candidates:items).slice(0,8).map(t=>({name:t.name,postalCode:t.postalCode}))}};
      payload={...payload,input:{...payload.input,guestEmail:payload.input.guestEmail||undefined,shipping:{...shipping,city:town.name,postalCode:shipping.postalCode?.trim()||town.postalCode,xExpressTownId:town.townId}}};
    }
    const body = JSON.stringify(payload);
    const response = await fetch(url, {method:'POST', headers:{'content-type':'application/json',...signRequest(body,secret)},body,signal:AbortSignal.timeout(25000),redirect:'error'});
    if (response.status===400&&(payload.action==='quote'||payload.action==='staff_quote')) {
      // Field validation failure: let the seller ask for the bad field.
      return {ok:false,error:{code:'INVALID_INPUT',message:'Podaci za dostavu nisu prihvaćeni. Proveri i pitaj samo za neispravno polje: ime i prezime (najmanje 2 slova), telefon, ulica, kućni broj (npr. 12, 12A, 12/3, bb), poštanski broj od 5 cifara. Ostale podatke ne traži ponovo.'}};
    }
    if (!response.ok) throw new Error(`SPC_HTTP_${response.status}`);
    return response.json();
  };
}

// Same rule as ERP src/lib/address/house-number.ts.
const HOUSE_NUMBER=/^(?:bb|[1-9]\d*[\p{L}]?(?:[/-][\p{L}\d]+)*)$/iu;
export function validHouseNumber(value){const v=String(value??'').replace(/\s+/g,'');return v.length<=20&&HOUSE_NUMBER.test(/^b\.?b\.?$/i.test(v)?'bb':v);}
export function houseNumberForErp(value){
 let v=String(value).trim().replace(/\s+/g,' ');
 // „13 stan 1“, „13, st. 1“, „13/II stan 5“ → 13/1; floor/entrance words are dropped.
 v=v.replace(/^(\d+\s?[\p{L}]?)\s*,?\s*(?:stan|st\.?|ap\.?|apartman)\s*(\d+[\p{L}]?)$/iu,'$1/$2');
 v=v.replace(/^(\d+\s?[\p{L}]?)\s*,?\s*(?:ulaz|sprat|sp\.?)\s*[\p{L}\d]+$/iu,'$1');
 v=v.replace(/\s+/g,'').replace(/^b\.?b\.?$/i,'bb');
 return v.replace(/^0+(?=[1-9]\d*(?:[A-Za-z]|[/-][\p{L}\d]+)*$)/u,'');
}
