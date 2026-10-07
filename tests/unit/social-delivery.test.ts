import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({db:vi.fn(),product:vi.fn(),resolve:vi.fn(),loyalty:vi.fn()}));
vi.mock('@/lib/db',()=>({hasDatabaseConnection:m.db,db:{}}));
vi.mock('@/lib/api/catalog',()=>({getProductBySku:m.product,listProducts:vi.fn()}));
vi.mock('@/lib/checkout/config',()=>({resolveDeliveryQuote:m.resolve}));
vi.mock('@/lib/loyalty/channel.server',()=>({channelLoyalty:m.loyalty}));
import {socialDeliveryRequest,socialDeliveryQuote} from '../../src/lib/social/delivery';
const input={action:'delivery_quote' as const,channel:'facebook' as const,conversationId:'fb:synthetic',city:'Beograd',shippingMethod:'KURIR' as const,lines:[{sku:'CHAIR',qty:4}]};
beforeEach(()=>{vi.resetAllMocks();m.db.mockReturnValue(true);m.product.mockImplementation(async sku=>({sku,name:sku}));m.loyalty.mockResolvedValue(null);m.resolve.mockResolvedValue({prices:{kurir:799,kamion:null},truckAvailable:false,pricingIssue:null});});
it('calculates the whole cart using checkout, with no contact data or order creation',async()=>{
 const result=await socialDeliveryQuote(input,'secret');
 expect(result).toMatchObject({ok:true,shipping:799,city:'Beograd',lines:[{sku:'CHAIR',qty:4}],orderCreated:false,pricingBasis:'regular'});
 expect(m.resolve).toHaveBeenCalledWith({city:undefined,lines:input.lines,loggedIn:false});
 expect(result).not.toHaveProperty('quoteToken');
});
it('recalculates changed quantities and normalizes duplicate lines',async()=>{
 await socialDeliveryQuote({...input,lines:[{sku:'CHAIR',qty:2},{sku:'CHAIR',qty:4},{sku:'IRON',qty:1}]},'secret');
 expect(m.resolve).toHaveBeenCalledWith({city:undefined,lines:[{sku:'CHAIR',qty:6},{sku:'IRON',qty:1}],loggedIn:false});
 expect((await socialDeliveryQuote({...input,lines:[{sku:'CHAIR',qty:99},{sku:'CHAIR',qty:1}]},'secret')).ok).toBe(false);
});
it('does not price missing products, missing DB, unsupported delivery or unknown tariffs',async()=>{
 m.db.mockReturnValueOnce(false);expect((await socialDeliveryQuote(input,'s')).ok).toBe(false);expect(m.resolve).not.toHaveBeenCalled();
 m.product.mockResolvedValueOnce(null);expect(await socialDeliveryQuote(input,'s')).toMatchObject({ok:false,error:{code:'PRODUCT_NOT_FOUND'}});expect(m.resolve).not.toHaveBeenCalled();
 expect((await socialDeliveryQuote({...input,shippingMethod:'KAMION'},'s')).ok).toBe(false);
 for(const quote of [{prices:{kurir:null}},{prices:{kurir:NaN}},{prices:{kurir:-1}},{prices:{kurir:799},pricingIssue:'WEIGHT_OUTSIDE_TARIFF'}]){
  m.resolve.mockResolvedValueOnce(quote);expect((await socialDeliveryQuote(input,'s')).ok).toBe(false);
 }
});
it('accepts zero shipping and only server-verified membership, rejects stale proof',async()=>{
 m.resolve.mockResolvedValue({prices:{kurir:0},pricingIssue:null});
 const member={...input,email:'buyer@example.com',loyaltyProof:'proof'};
 expect((await socialDeliveryQuote(member,'s')).ok).toBe(false);expect(m.resolve).not.toHaveBeenCalled();
 m.loyalty.mockResolvedValue({email:member.email});
 expect(await socialDeliveryQuote(member,'s')).toMatchObject({ok:true,shipping:0,pricingBasis:'loyalty'});
 expect(m.loyalty).toHaveBeenLastCalledWith('proof',{channel:input.channel,conversationId:input.conversationId,email:member.email},'s');
 expect(m.resolve).toHaveBeenLastCalledWith({city:undefined,lines:input.lines,loggedIn:true});
});
it('allows courier quotes without a town, but truck delivery still requires one',async()=>{
 const {city,...noCity}=input;
 expect(socialDeliveryRequest.safeParse(noCity).success).toBe(true);
 expect(await socialDeliveryQuote(noCity,'s')).toMatchObject({ok:true,shipping:799});
 expect(m.resolve).toHaveBeenCalledWith({city:undefined,lines:input.lines,loggedIn:false});
 expect(await socialDeliveryQuote({...noCity,shippingMethod:'KAMION'},'s')).toMatchObject({ok:false,error:{code:'DELIVERY_CITY_REQUIRED'}});
});
it('validates required city, nonempty items and positive bounded quantities',()=>{
 expect(socialDeliveryRequest.safeParse(input).success).toBe(true);
 for(const patch of [{city:''},{lines:[]},{lines:[{sku:'CHAIR',qty:0}]},{lines:[{sku:'CHAIR',qty:1.5}]},{lines:[{sku:'CHAIR',qty:100}]}])expect(socialDeliveryRequest.safeParse({...input,...patch}).success).toBe(false);
 expect(socialDeliveryRequest.parse({...input,loggedIn:true})).not.toHaveProperty('loggedIn');
});
