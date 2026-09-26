import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createOrderSchema } from '../../src/lib/checkout/order-schema';
const mocks=vi.hoisted(()=>({create:vi.fn(),session:vi.fn(),search:vi.fn(),reclamation:vi.fn(),order:vi.fn(),token:vi.fn(),cancel:vi.fn(),product:vi.fn()}));
vi.mock('next/server',()=>({NextResponse:{json:(data:unknown,init?:ResponseInit)=>Response.json(data,init)},after:vi.fn()}));
vi.mock('@/lib/api/checkout',async()=>({createOrder:mocks.create,createOrderSchema:(await import('../../src/lib/checkout/order-schema')).createOrderSchema}));
vi.mock('@/lib/api/catalog',()=>({getProductBySku:mocks.product,listProducts:mocks.search}));
vi.mock('@/lib/pricing',()=>({resolveProductPriceQuote:()=>({payable:{effective:1499}})}));
vi.mock('@/lib/db',()=>({db:{checkoutSession:{findUnique:mocks.session},order:{findUnique:mocks.order}}}));
vi.mock('@/lib/api/order-access',()=>({verifyOrderAccessToken:mocks.token}));
vi.mock('@/lib/api/reclamations',()=>({createGuestReclamation:mocks.reclamation,createReclamationSchema:createOrderSchema}));
vi.mock('@/lib/checkout/outbox',()=>({checkoutFollowUpKey:vi.fn()}));
vi.mock('@/lib/orders/cancellation.server',()=>({cancelWebOrderByCustomer:mocks.cancel}));
import { signSocialQuote } from '../../src/lib/social/security';
import { OrderCancellationError } from '../../src/lib/orders/cancellation';
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

describe('social cancellation and current availability',()=>{
  const identity={channel:'facebook',conversationId:'fb:owner'};
  const order={id:'order-1',number:'SPC-TEST-1',status:'POTVRDJENO',channel:'WEB',publicAccessTokenHash:'hash',fiscal:null,fiscalDocuments:[],reshipments:[],items:[{sku:'CHAIR',name:'Chair',qty:6}]};
  const prep=()=>POST(request({action:'prepare_cancellation',...identity,number:order.number,accessToken:'private'}));
  beforeEach(()=>{mocks.order.mockResolvedValue(order);mocks.token.mockReturnValue(true);mocks.cancel.mockResolvedValue({alreadyCancelled:false,paymentReviewRequired:false,activeShipmentCount:0,pickupBatchNumbers:[]});});
  it('preparation is read-only; number without owner token cannot cancel',async()=>{
    const preview=await (await prep()).json();expect(preview.cancellationToken).toBeTruthy();expect(mocks.cancel).not.toHaveBeenCalled();
    mocks.token.mockReturnValue(false);expect((await prep()).status).toBe(403);
    expect((await POST(request({action:'cancel_order',...identity,accessToken:'wrong',cancellationToken:preview.cancellationToken}))).status).toBe(403);expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('binds cancellation to purpose, channel, conversation and selected order',async()=>{
    const preview=await (await prep()).json();
    for(const other of [{...identity,channel:'instagram'},{...identity,conversationId:'fb:other'}]) expect((await POST(request({action:'cancel_order',...other,accessToken:'private',cancellationToken:preview.cancellationToken}))).status).toBe(403);
    const wrong=signSocialQuote({...identity,number:order.number,expiresAt:Date.now()+60000,purpose:'create_order'},secret);
    expect((await POST(request({action:'cancel_order',...identity,accessToken:'private',cancellationToken:wrong}))).status).toBe(403);
    expect(mocks.cancel).not.toHaveBeenCalled();
    const r=await (await POST(request({action:'cancel_order',...identity,accessToken:'private',cancellationToken:preview.cancellationToken}))).json();
    expect(r.ok).toBe(true);expect(mocks.cancel).toHaveBeenCalledWith({orderId:order.id,requestedViaSocial:'facebook'});
  });
  it('rejects expired confirmations but safely acknowledges an already cancelled order',async()=>{
    const cancellationToken=signSocialQuote({...identity,purpose:'cancel_order',number:order.number,expiresAt:Date.now()-1000},secret);
    const payload={action:'cancel_order',...identity,accessToken:'private',cancellationToken};
    expect((await (await POST(request(payload))).json()).error.code).toBe('CANCELLATION_EXPIRED');
    mocks.order.mockResolvedValue({...order,status:'OTKAZANO'});
    expect((await (await POST(request(payload))).json()).alreadyCancelled).toBe(true);expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('rechecks fiscalization and handles transaction eligibility races',async()=>{
    const preview=await (await prep()).json();
    mocks.order.mockResolvedValue({...order,fiscal:{id:'fiscal'}});
    expect((await (await prep()).json()).ok).toBe(false);expect(mocks.cancel).not.toHaveBeenCalled();
    mocks.order.mockResolvedValue(order);mocks.cancel.mockRejectedValue(new OrderCancellationError('Changed','IN_PROGRESS'));
    expect((await (await POST(request({action:'cancel_order',...identity,accessToken:'private',cancellationToken:preview.cancellationToken}))).json()).error.code).toBe('CANCELLATION_IN_PROGRESS');
  });
  it('refreshes stale catalog results and checks requested quantity',async()=>{
    mocks.product.mockImplementation(async(sku:string)=>sku==='CURRENT'?{sku,name:'Current',stock:4,media:{images:[]}}:null);
    mocks.search.mockResolvedValue({items:[{sku:'OLD'},{sku:'CURRENT'}]});
    const r=await (await POST(request({action:'search',query:'Chair',quantity:6}))).json();
    expect(r.items).toHaveLength(1);expect(r.items[0]).toMatchObject({sku:'CURRENT',available:false,checkedQuantity:6});
  });
});
