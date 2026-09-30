import { selectTown } from './delivery.mjs';
import { signRequest } from './security.mjs';
export function createSpcClient(base, secret) {
  const url = new URL('/api/integrations/social',base);
  if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('SPC_HTTPS_REQUIRED');
  return async payload => {
    if(payload.action==='quote') {
      const shipping=payload.input.shipping;
      const lookup=new URL('/api/x-express/locations',base);
      lookup.searchParams.set('q',shipping.postalCode?.trim()||shipping.city);lookup.searchParams.set('limit','20');
      const response=await fetch(lookup,{signal:AbortSignal.timeout(12000),redirect:'error'});
      if(!response.ok) throw new Error('SPC_DELIVERY_LOOKUP_FAILED');
      const {items=[]}=await response.json();const town=selectTown(items,shipping);
      if(!town) return {ok:false,error:{code:'DELIVERY_ADDRESS_INVALID',message:'Pitaj samo za tačno naselje/opštinu da razjasniš mesto. Poštanski broj popunjava sistem; ne izmišljaj ga i ne biraj proizvoljno među istoimenim mestima.',candidates:items.slice(0,8).map(t=>({name:t.name,postalCode:t.postalCode}))}};
      payload={...payload,input:{...payload.input,guestEmail:payload.input.guestEmail||undefined,shipping:{...shipping,city:town.name,postalCode:town.postalCode,xExpressTownId:town.townId}}};
    }
    const body = JSON.stringify(payload);
    const response = await fetch(url, {method:'POST', headers:{'content-type':'application/json',...signRequest(body,secret)},body,signal:AbortSignal.timeout(25000),redirect:'error'});
    if (!response.ok) throw new Error(`SPC_HTTP_${response.status}`);
    return response.json();
  };
}
