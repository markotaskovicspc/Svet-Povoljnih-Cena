import {z} from 'zod';
import {hasDatabaseConnection} from '@/lib/db';
import {getProductBySku} from '@/lib/api/catalog';
import {resolveDeliveryQuote} from '@/lib/checkout/config';
import {channelLoyalty} from '@/lib/loyalty/channel.server';

export const socialDeliveryRequest=z.object({
 action:z.literal('delivery_quote'),
 channel:z.enum(['facebook','instagram']),conversationId:z.string().min(3).max(200),
 city:z.string().trim().min(2).max(120),
 lines:z.array(z.object({sku:z.string().trim().min(1).max(80),qty:z.number().int().positive().max(99)})).min(1).max(50),
 shippingMethod:z.enum(['KURIR','KAMION']),
 email:z.email().optional(),loyaltyProof:z.string().max(5000).optional(),
});

// The same read-only resolver used by checkout; never creates a checkout session or order.
export async function socialDeliveryQuote(body:z.infer<typeof socialDeliveryRequest>,secret:string){
 if(!hasDatabaseConnection())return {ok:false,error:{code:'DELIVERY_PRICE_UNAVAILABLE'}};
 const quantities=new Map<string,number>();
 for(const line of body.lines)quantities.set(line.sku,(quantities.get(line.sku)??0)+line.qty);
 const lines=[...quantities].map(([sku,qty])=>({sku,qty}));
 if(lines.some(line=>line.qty>99))return {ok:false,error:{code:'QUANTITY_LIMIT'}};
 const products=await Promise.all(lines.map(line=>getProductBySku(line.sku)));
 const missing=products.findIndex(p=>!p);
 if(missing!==-1)return {ok:false,error:{code:'PRODUCT_NOT_FOUND',sku:lines[missing].sku}};
 const loyalty=await channelLoyalty(body.loyaltyProof,{channel:body.channel,conversationId:body.conversationId,email:body.email??''},secret);
 if(body.loyaltyProof&&!loyalty)return {ok:false,error:{code:'LOYALTY_CONSENT_REQUIRED'}};
 const quote=await resolveDeliveryQuote({city:body.city,lines,loggedIn:Boolean(loyalty)});
 const price=body.shippingMethod==='KURIR'?quote.prices.kurir:quote.prices.kamion;
 if(quote.pricingIssue||(body.shippingMethod==='KAMION'&&!quote.truckAvailable)||price==null||!Number.isFinite(price)||price<0)
  return {ok:false,error:{code:'DELIVERY_PRICE_UNAVAILABLE'}};
 return {ok:true,shipping:price,currency:'RSD',city:body.city,shippingMethod:body.shippingMethod,
  lines:lines.map((line,i)=>({...line,name:products[i]!.name})),pricingBasis:loyalty?'loyalty':'regular',
  checkedAt:new Date().toISOString(),orderCreated:false};
}
