import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({order:vi.fn(),session:vi.fn(),claim:vi.fn(),create:vi.fn(),cancel:vi.fn(),reclaim:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/db',()=>({db:{order:{findFirst:m.order},checkoutSession:{findUnique:m.session},reclamation:{findUnique:m.claim}}}));
vi.mock('@/lib/orders/cancellation.server',()=>({cancelWebOrderByCustomer:m.cancel}));
vi.mock('@/lib/api/catalog',()=>({getProductBySku:vi.fn()}));
vi.mock('@/lib/api/checkout',async()=>{const {z}=await import('zod');return {createOrder:m.create,createOrderSchema:z.object({checkoutSessionId:z.string()}).passthrough()};});
vi.mock('@/lib/api/reclamations',async()=>{const {z}=await import('zod');return {createSocialReclamation:m.reclaim,createReclamationSchema:z.object({orderNumberOrFiscal:z.string(),sku:z.string(),quantity:z.number(),description:z.string(),photos:z.array(z.string())})};});
import {handleEmailAction} from '@/lib/social/email-actions';
import {signSocialQuote} from '@/lib/social/security';
const secret='email-action-synthetic-secret'.repeat(3);
const base={purpose:'email_action',sender:'buyer@example.com',requestId:'a'.repeat(64),expiresAt:Date.now()+60000};
const execute=(payload:object,sender=base.sender)=>handleEmailAction({action:'execute',sender,confirmed:true,token:signSocialQuote(payload,secret)},secret);
beforeEach(()=>{vi.clearAllMocks();m.order.mockResolvedValue({id:'order1',number:'TEST-1',status:'KREIRANO'});m.session.mockResolvedValue(null);m.claim.mockResolvedValue(null);m.cancel.mockResolvedValue({paymentReviewRequired:false,activeShipmentCount:0});});
it('binds signed action to sender and rejects another-purpose token before writes',async()=>{
 expect(await execute({...base,kind:'cancel',orderId:'order1',number:'TEST-1'},'other@example.com')).toMatchObject({ok:false});
 expect(await execute({...base,purpose:'social_action',kind:'cancel',orderId:'order1',number:'TEST-1'})).toMatchObject({ok:false});
 expect(m.cancel).not.toHaveBeenCalled();expect(m.order).not.toHaveBeenCalled();
});
it('rechecks ownership and never cancels expired pending requests',async()=>{
 expect(await execute({...base,kind:'cancel',orderId:'order1',number:'TEST-1',expiresAt:1})).toMatchObject({ok:false,error:{code:'OFFER_EXPIRED'}});
 expect(m.order.mock.calls[0][0].where.OR[0].guestEmail.equals).toBe(base.sender);expect(m.cancel).not.toHaveBeenCalled();
});
it('already cancelled order returns receipt even after token expiry without another mutation',async()=>{
 m.order.mockResolvedValue({id:'order1',number:'TEST-1',status:'OTKAZANO'});
 expect(await execute({...base,kind:'cancel',orderId:'order1',number:'TEST-1',expiresAt:1})).toMatchObject({ok:true,alreadyCancelled:true});expect(m.cancel).not.toHaveBeenCalled();
});
it('prepared claim blocks undelivered orders',async()=>{
 expect(await handleEmailAction({action:'prepare_claim',sender:base.sender,requestId:base.requestId,input:{orderNumberOrFiscal:'TEST-1',sku:'SKU',quantity:1,description:'Ne radi',photos:[],category:'KVAR',request:'ZAMENA'}},secret)).toMatchObject({ok:false,error:{code:'ORDER_NOT_DELIVERED'}});expect(m.reclaim).not.toHaveBeenCalled();
});
it('claim replay returns existing ticket, never creates another',async()=>{
 m.claim.mockResolvedValue({id:'claim1',number:'REK-1'});
 expect(await execute({...base,kind:'claim',orderId:'order1',claimId:'claim1',expiresAt:1,input:{orderNumberOrFiscal:'TEST-1',sku:'SKU',quantity:1,description:'Ne radi',photos:[],category:'KVAR',request:'ZAMENA'}})).toMatchObject({ok:true,number:'REK-1'});expect(m.reclaim).not.toHaveBeenCalled();
});
it('purchase reuses its exact checkout session and expected total',async()=>{
 m.create.mockResolvedValue({ok:true,data:{id:'order1',number:'TEST-1',total:1000}});
 const token={...base,kind:'purchase',input:{checkoutSessionId:'email_fixed'},total:1000};
 expect(await execute(token)).toMatchObject({ok:true,number:'TEST-1'});
 expect(m.create).toHaveBeenCalledWith(token.input,null,null,{expectedTotal:1000,customerReplyDraftOnly:true});
});
