import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createOrderSchema } from '../../src/lib/checkout/order-schema';
const mocks=vi.hoisted(()=>({create:vi.fn(),session:vi.fn(),search:vi.fn(),reclamation:vi.fn()}));
vi.mock('next/server',()=>({NextResponse:{json:(data:unknown,init?:ResponseInit)=>Response.json(data,init)},after:vi.fn()}));
vi.mock('@/lib/api/checkout',async()=>({createOrder:mocks.create,createOrderSchema:(await import('../../src/lib/checkout/order-schema')).createOrderSchema}));
vi.mock('@/lib/api/catalog',()=>({getProductBySku:vi.fn(),listProducts:mocks.search}));
vi.mock('@/lib/pricing',()=>({resolveProductPriceQuote:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{checkoutSession:{findUnique:mocks.session}}}));
vi.mock('@/lib/api/order-access',()=>({verifyOrderAccessToken:vi.fn()}));
vi.mock('@/lib/api/reclamations',()=>({createGuestReclamation:mocks.reclamation,createReclamationSchema:createOrderSchema}));
vi.mock('@/lib/checkout/outbox',()=>({checkoutFollowUpKey:vi.fn()}));
import { POST } from '../../src/app/api/integrations/social/route';
const secret='test-secret-'.repeat(5);
const input={guestEmail:'buyer@example.com',lines:[{sku:'210.025',qty:1}],shipping:{firstName:'Test',lastName:'Kupac',phone:'0600000000',street:'Test ulica',houseNumber:'12',city:'Beograd',postalCode:'11000'},shippingMethod:'KURIR',paymentMethod:'POUZECE_GOTOVINA',consent:true};
function request(data:unknown,signed=true){const body=JSON.stringify(data),ts=String(Date.now());return new Request('https://spc.test/api/integrations/social',{method:'POST',body,headers:{'x-spc-timestamp':ts,'x-spc-signature':signed?createHmac('sha256',secret).update(`${ts}.${body}`).digest('hex'):'invalid'}});}
beforeEach(()=>{vi.clearAllMocks();process.env.SOCIAL_INTEGRATION_SECRET=secret;mocks.session.mockResolvedValue(null);mocks.create.mockResolvedValue({ok:true,data:{id:'',number:'',accessToken:'',total:2000,subtotal:1010,savings:0,shipping:990,assemblyTotal:0,paymentMethod:'POUZECE_GOTOVINA',shippingMethod:'KURIR',voucherDiscount:0,firstPurchaseDiscount:0,savedCardDiscount:0}});});
describe('SPC social order bridge',()=>{
  it('rejects unsigned requests before invoking any business operation',async()=>{expect((await POST(request({action:'search',query:'komoda'},false))).status).toBe(401);expect(mocks.create).not.toHaveBeenCalled();});
  it('quotes through checkout in preview mode and removes caller-controlled loyalty',async()=>{
    const r=await POST(request({action:'quote',channel:'facebook',conversationId:'fb:123:456',input:{...input,guestLoyalty:true,voucherCode:'UNTRUSTED'}}));const body=await r.json();
    expect(body.ok).toBe(true);expect(body.quoteToken).toBeTruthy();expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({guestLoyalty:false,voucherCode:undefined,checkoutSessionId:expect.any(String)}),null,null,{previewOnly:true});
  });
  it('binds order write to signed buyer, conversation and expected total',async()=>{
    const quote=await (await POST(request({action:'quote',channel:'facebook',conversationId:'fb:123:456',input}))).json();mocks.create.mockClear();
    const r=await POST(request({action:'create_order',channel:'instagram',conversationId:'ig:wrong',quoteToken:quote.quoteToken}));expect(r.status).toBe(403);expect(mocks.create).not.toHaveBeenCalled();
    await POST(request({action:'create_order',channel:'facebook',conversationId:'fb:123:456',quoteToken:quote.quoteToken}));expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({guestEmail:'buyer@example.com'}),null,null,{expectedTotal:2000});
  });
});
