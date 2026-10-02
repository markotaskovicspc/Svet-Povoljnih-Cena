import { selectTown } from './delivery.mjs';
import { signRequest } from './security.mjs';
export function createSpcClient(base, secret) {
  const url = new URL('/api/integrations/social',base);
  if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('SPC_HTTPS_REQUIRED');
  return async payload => {
    if(payload.action==='quote'||payload.action==='staff_quote') {
      const supplied=payload.input.shipping;
      // Formatting only: 033 is the same building as 33. Keep suffixes and
      // slash-separated address components; never guess a missing number.
      const shipping={...supplied,houseNumber:typeof supplied.houseNumber==='string'?supplied.houseNumber.trim().replace(/^0+(?=[1-9]\d*(?:[A-Za-z]|[/-][\p{L}\d]+)*$)/u,''):supplied.houseNumber};
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
      if(!town) return {ok:false,error:{code:'DELIVERY_ADDRESS_INVALID',message:'Pitaj samo za tačno naselje/opštinu da razjasniš mesto. Poštanski broj popunjava sistem; ne izmišljaj ga i ne biraj proizvoljno među istoimenim mestima.',candidates:items.slice(0,8).map(t=>({name:t.name,postalCode:t.postalCode}))}};
      payload={...payload,input:{...payload.input,guestEmail:payload.input.guestEmail||undefined,shipping:{...shipping,city:town.name,postalCode:town.postalCode,xExpressTownId:town.townId}}};
    }
    const body = JSON.stringify(payload);
    const response = await fetch(url, {method:'POST', headers:{'content-type':'application/json',...signRequest(body,secret)},body,signal:AbortSignal.timeout(25000),redirect:'error'});
    if (!response.ok) throw new Error(`SPC_HTTP_${response.status}`);
    return response.json();
  };
}
