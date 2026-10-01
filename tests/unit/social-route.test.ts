import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createOrderSchema } from '../../src/lib/checkout/order-schema';
const mocks=vi.hoisted(()=>({create:vi.fn(),session:vi.fn(),search:vi.fn(),reclamation:vi.fn(),order:vi.fn(),token:vi.fn(),cancel:vi.fn(),product:vi.fn(),mail:vi.fn()}));
vi.mock('next/server',()=>({NextResponse:{json:(data:unknown,init?:ResponseInit)=>Response.json(data,init)},after:vi.fn()}));
vi.mock('@/lib/api/checkout',async()=>({createOrder:mocks.create,createOrderSchema:(await import('../../src/lib/checkout/order-schema')).createOrderSchema}));
vi.mock('@/lib/api/catalog',()=>({getProductBySku:mocks.product,listProducts:mocks.search}));
vi.mock('@/lib/pricing',()=>({resolveProductPriceQuote:()=>({payable:{effective:1499}})}));
vi.mock('@/lib/db',()=>({hasDatabaseConnection:()=>true,db:{checkoutSession:{findUnique:mocks.session},order:{findUnique:mocks.order}}}));
vi.mock('@/lib/api/order-access',()=>({verifyOrderAccessToken:mocks.token}));
vi.mock('@/lib/api/reclamations',()=>({createGuestReclamation:mocks.reclamation,createReclamationSchema:createOrderSchema}));
vi.mock('@/lib/checkout/outbox',()=>({checkoutFollowUpKey:vi.fn()}));
vi.mock('@/lib/orders/cancellation.server',()=>({cancelWebOrderByCustomer:mocks.cancel}));
vi.mock('@/lib/checkout/config',()=>({resolveDeliveryQuote:vi.fn(async()=>({prices:{kurir:799,kamion:null},pricingIssue:null,truckAvailable:false}))}));
vi.mock('@/lib/email/config',()=>({getEmailConfig:()=>({provider:'test'})}));
vi.mock('@/lib/email/tracking',()=>({trackedDispatch:mocks.mail}));
import { signSocialQuote } from '../../src/lib/social/security';
import { OrderCancellationError } from '../../src/lib/orders/cancellation';
import { POST } from '../../src/app/api/integrations/social/route';
const secret='test-secret-'.repeat(5);
const input={guestEmail:'buyer@example.com',lines:[{sku:'210.025',qty:1}],shipping:{firstName:'Test',lastName:'Kupac',phone:'0600000000',street:'Test ulica',houseNumber:'12',city:'Beograd',postalCode:'11000'},shippingMethod:'KURIR',paymentMethod:'POUZECE_GOTOVINA',consent:true};
function request(data:unknown,signed=true){const body=JSON.stringify(data),ts=String(Date.now());return new Request('https://spc.test/api/integrations/social',{method:'POST',body,headers:{'x-spc-timestamp':ts,'x-spc-signature':signed?createHmac('sha256',secret).update(`${ts}.${body}`).digest('hex'):'invalid'}});}
beforeEach(()=>{vi.clearAllMocks();process.env.SOCIAL_INTEGRATION_SECRET=secret;mocks.session.mockResolvedValue(null);mocks.create.mockResolvedValue({ok:true,data:{id:'',number:'',accessToken:'',total:2000,subtotal:1010,savings:0,shipping:990,assemblyTotal:0,paymentMethod:'POUZECE_GOTOVINA',shippingMethod:'KURIR',voucherDiscount:0,firstPurchaseDiscount:0,savedCardDiscount:0}});});
describe('SPC social order bridge',()=>{
  it('exposes authenticated read-only delivery without customer contacts or order preparation',async()=>{
    const payload={action:'delivery_quote',channel:'facebook',conversationId:'fb:123:456',lines:[{sku:'CHAIR',qty:4}],city:'Beograd',shippingMethod:'KURIR'};
    expect((await POST(request(payload,false))).status).toBe(401);expect(mocks.product).not.toHaveBeenCalled();
    mocks.product.mockResolvedValue({sku:'CHAIR',name:'Chair'});
    expect(await(await POST(request(payload))).json()).toMatchObject({ok:true,shipping:799,orderCreated:false});
    expect((await POST(request({...payload,city:''}))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled();
  });
  it('reads public product details by exact SKU without invoking checkout',async()=>{
    expect((await POST(request({action:'product_details',sku:'FEN'},false))).status).toBe(401);
    expect(mocks.product).not.toHaveBeenCalled();
    mocks.product.mockResolvedValue({sku:'FEN',slug:'fen',name:'Fen',description:'Dužina 23 cm',dimensionsCm:{w:0,d:0,h:0},materials:[],stock:99});
    const r=await(await POST(request({action:'product_details',sku:'FEN'}))).json();
    expect(r).toMatchObject({ok:true,product:{sku:'FEN',description:'Dužina 23 cm',dimensions:null}});expect(r.product).not.toHaveProperty('stock');expect(mocks.create).not.toHaveBeenCalled();
    mocks.product.mockResolvedValue(null);expect(await(await POST(request({action:'product_details',sku:'missing'}))).json()).toEqual({ok:false,error:{code:'PRODUCT_NOT_FOUND'}});
  });
  it('rejects unsigned requests before invoking any business operation',async()=>{expect((await POST(request({action:'search',query:'komoda'},false))).status).toBe(401);expect(mocks.create).not.toHaveBeenCalled();});
  it('quotes through checkout in preview mode and removes caller-controlled loyalty',async()=>{
    const r=await POST(request({action:'quote',channel:'facebook',conversationId:'fb:123:456',input:{...input,guestLoyalty:true,voucherCode:'UNTRUSTED'}}));const body=await r.json();
    expect(body.ok).toBe(true);expect(body.quoteToken).toBeTruthy();expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({guestLoyalty:false,voucherCode:undefined,checkoutSessionId:expect.any(String)}),null,null,{previewOnly:true,allowGuestWithoutEmail:true});
  });
  it('binds order write to signed buyer, conversation and expected total',async()=>{
    const quote=await (await POST(request({action:'quote',channel:'facebook',conversationId:'fb:123:456',input}))).json();mocks.create.mockClear();
    const r=await POST(request({action:'create_order',channel:'instagram',conversationId:'ig:wrong',quoteToken:quote.quoteToken}));expect(r.status).toBe(403);expect(mocks.create).not.toHaveBeenCalled();
    await POST(request({action:'create_order',channel:'facebook',conversationId:'fb:123:456',quoteToken:quote.quoteToken}));expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({guestEmail:'buyer@example.com'}),null,null,{expectedTotal:2000,allowGuestWithoutEmail:true,customerReplyDraftOnly:false});
  });
  it('keeps delivery instructions separate from street/house number through signed quote and creation',async()=>{
    const identity={channel:'facebook',conversationId:'fb:notes'};
    const q=await(await POST(request({action:'quote',...identity,input:{...input,notes:'ulaz C stan br 8'}}))).json();
    expect(q.ok).toBe(true);expect(q.input.shipping).toMatchObject({street:'Test ulica',houseNumber:'12'});
    expect(q.input.notes).toBe('[FACEBOOK] fb:notes\nNapomena kupca: ulaz C stan br 8');
    mocks.create.mockClear();await POST(request({action:'create_order',...identity,quoteToken:q.quoteToken}));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({notes:q.input.notes}),null,null,expect.objectContaining({expectedTotal:2000}));
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

it('signed social checkout accepts no email and suppresses nonexistent buyer email, while missing address is rejected',async()=>{const noEmail={...input,guestEmail:undefined};const identity={channel:'facebook',conversationId:'fb:test:noemail'};const q=await(await POST(request({action:'quote',...identity,input:noEmail}))).json();expect(q.ok).toBe(true);mocks.create.mockClear();await POST(request({action:'create_order',...identity,quoteToken:q.quoteToken}));expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({shipping:expect.objectContaining(noEmail.shipping)}),null,null,{expectedTotal:2000,allowGuestWithoutEmail:true,customerReplyDraftOnly:true});expect((await POST(request({action:'quote',...identity,input:{...noEmail,shipping:{...input.shipping,phone:''}}}))).status).toBe(400);});

it('support notification has a clickable verified conversation link and rejects foreign destinations',async()=>{mocks.mail.mockResolvedValue({ok:true,provider:'test'});const payload={action:'support_handoff',channel:'facebook',conversationId:'facebook:123:456',id:'event',reason:'Test',transcript:'Sintetička poruka',conversationLink:'https://business.facebook.com/latest/inbox/all/?asset_id=123&selected_item_id=789'};expect((await(await POST(request(payload))).json()).ok).toBe(true);expect(mocks.mail.mock.calls.at(-1)[0].html).toContain('selected_item_id=789');expect(mocks.mail.mock.calls.at(-1)[0].html).toContain('Otvori razgovor u Business Suite-u');expect((await POST(request({...payload,conversationLink:'https://evil.test/latest/inbox/all/'}))).status).toBe(400);});

it('support fallback identifies the buyer and Business Suite inbox without inventing a Meta thread',async()=>{
 mocks.mail.mockResolvedValue({ok:true,provider:'test'});
 const payload={action:'support_handoff',channel:'facebook',conversationId:'facebook:123:456',id:'fallback',reason:'Test',transcript:'Poruka',customerName:'Buyer <script>',inboxUrl:'https://business.facebook.com/latest/inbox/all/?asset_id=123&mailbox_id=123'};
 expect((await POST(request(payload))).status).toBe(200);
 const mail=mocks.mail.mock.calls.at(-1)[0];
 expect(mail.html).not.toContain('railway.app');expect(mail.text).toContain('U pretrazi inboxa unesite: Buyer <script>');
 expect(mail.html).toContain('Buyer &lt;script&gt;');expect(mail.html).not.toContain('<script>');expect(mail.html).not.toContain('selected_item_id');expect(mail.html).not.toContain('pristupni ključ operatera');
 expect((await POST(request({...payload,inboxUrl:payload.inboxUrl+'&selected_item_id=456'}))).status).toBe(400);
 expect((await POST(request({...payload,inboxUrl:'https://evil.test/'}))).status).toBe(400);
});

it('binds seller-approved catalog prices to the signed quote without granting membership',async()=>{
 const identity={channel:'facebook',conversationId:'fb:staff'};
 const staffPricing={commandId:'seller-event',prices:[{sku:input.lines[0].sku,price:700}]};
 const payload={action:'staff_quote',...identity,input:{...input,guestEmail:undefined},staffPricing};
 expect((await POST(request(payload,false))).status).toBe(401);expect(mocks.create).not.toHaveBeenCalled();
 const q=await(await POST(request(payload))).json();expect(q.ok).toBe(true);expect(q.staffPricingApplied).toBe(true);expect(q.loyaltyApplied).toBe(false);
 expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({guestLoyalty:false,notes:expect.stringContaining('bez članstva')}),null,null,{previewOnly:true,allowGuestWithoutEmail:true,staffLoyaltyPrices:staffPricing.prices});
 mocks.create.mockClear();await POST(request({action:'create_order',...identity,quoteToken:q.quoteToken,staffPricing:{...staffPricing,prices:[{sku:input.lines[0].sku,price:1}]}}));
 expect(mocks.create).toHaveBeenCalledWith(expect.anything(),null,null,expect.objectContaining({staffLoyaltyPrices:staffPricing.prices,customerReplyDraftOnly:true}));
 mocks.create.mockClear();expect((await POST(request({action:'create_order',...identity,conversationId:'fb:other',quoteToken:q.quoteToken}))).status).toBe(403);expect(mocks.create).not.toHaveBeenCalled();
 await POST(request({...payload,action:'quote'}));expect(mocks.create.mock.calls.at(-1)[3]).not.toHaveProperty('staffLoyaltyPrices');
});
