import { selectTown } from './delivery.mjs';
import { signRequest } from './security.mjs';
export function createSpcClient(base, secret) {
  const url = new URL('/api/integrations/social',base);
  if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('SPC_HTTPS_REQUIRED');
  return async payload => {
    if(payload.action==='quote' && payload.input.shippingMethod==='KURIR') {
      const shipping=payload.input.shipping;
      const lookup=new URL('/api/x-express/locations',base);
      lookup.searchParams.set('q',shipping.postalCode);lookup.searchParams.set('limit','20');
      const response=await fetch(lookup,{signal:AbortSignal.timeout(12000),redirect:'error'});
      if(!response.ok) throw new Error('SPC_DELIVERY_LOOKUP_FAILED');
      const {items=[]}=await response.json();const town=selectTown(items,shipping);
      if(!town) return {ok:false,error:{code:'DELIVERY_ADDRESS_INVALID',message:'Traži tačan naziv naselja i poštanski broj; ne biraj drugo mesto i ne izmišljaj ID.',candidates:items.slice(0,8).map(t=>({name:t.name,postalCode:t.postalCode}))}};
      payload={...payload,input:{...payload.input,shipping:{...shipping,city:town.name,postalCode:town.postalCode,xExpressTownId:town.townId}}};
    }
    const body = JSON.stringify(payload);
    const response = await fetch(url, {method:'POST', headers:{'content-type':'application/json',...signRequest(body,secret)},body,signal:AbortSignal.timeout(25000),redirect:'error'});
    if (!response.ok) throw new Error(`SPC_HTTP_${response.status}`);
    return response.json();
  };
}
