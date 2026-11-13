import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({findMany:vi.fn(),findUnique:vi.fn(),dispatch:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{order:{findMany:mocks.findMany,findUnique:mocks.findUnique}}}));
vi.mock('@/lib/email/tracking',()=>({trackedDispatch:mocks.dispatch}));
vi.mock('@/lib/background-jobs',()=>({enqueueBackgroundJob:vi.fn()}));
vi.mock('@/lib/email/adapt',()=>({loadOrderForEmail:vi.fn()}));
vi.mock('@/lib/email/render',()=>({renderEmail:vi.fn()}));
vi.mock('@/lib/email/order-link',()=>({orderLinkForEmail:vi.fn()}));
vi.mock('@/lib/email/templates/bank-payment-confirmation',()=>({BankPaymentConfirmation:vi.fn()}));
import {Prisma} from '@prisma/client';
import {sendBankUnmatchedReview} from '@/lib/email/bank-payment';
const entry={account:'340000100028300451' as const,statement:'225',date:'2026-11-13',bankReference:'FT26317ABCDE',amountMinor:365200,currency:'RSD' as const,sourceHash:'a'.repeat(64)};
beforeEach(()=>{vi.resetAllMocks();mocks.dispatch.mockResolvedValue({ok:true});mocks.findMany.mockResolvedValue([]);});
it('suggests only unpaid active bank-transfer orders with the exact total, without changing anything',async()=>{
 mocks.findMany.mockResolvedValue([{number:'SPC-2026-002340',createdAt:new Date('2026-11-10T10:00:00Z')}]);
 await sendBankUnmatchedReview({...entry,reason:'SPC_UNREADABLE'});
 const where=mocks.findMany.mock.calls[0][0].where;
 expect(where).toMatchObject({paymentMethod:'UPLATA_NA_RACUN',cancelledAt:null,stockRestoredAt:null,status:{notIn:['OTKAZANO','VRACENO']}});
 expect(where.total).toEqual(new Prisma.Decimal('3652'));
 expect(where.createdAt.gte).toEqual(new Date('2026-09-14T00:00:00Z'));
 const mail=mocks.dispatch.mock.calls[0][0];
 expect(mail.to).toBe('podrska@svetpovoljnihcena.rs');expect(mail.text).toContain('SPC-2026-002340');expect(mail.text).toContain('FT26317ABCDE');expect(mail.text).toContain('nije evidentirano');
});
it('credits with no SPC mention and no same-amount order send nothing',async()=>{
 expect(await sendBankUnmatchedReview({...entry,reason:'SPC_MISSING'})).toEqual({skipped:'NO_CANDIDATES'});expect(mocks.dispatch).not.toHaveBeenCalled();
});
it('order number found outside PBO is checked and reported as a suggestion',async()=>{
 mocks.findUnique.mockResolvedValue({paymentMethod:'UPLATA_NA_RACUN',status:'KREIRANO',total:new Prisma.Decimal('3652'),stockRestoredAt:null,cancelledAt:null,payments:[]});
 await sendBankUnmatchedReview({...entry,reason:'SPC_NOT_IN_REFERENCE',suggestedOrderNumber:'SPC-2026-002340'});
 expect(mocks.dispatch.mock.calls[0][0].text).toContain('SPC-2026-002340 — iznos i način plaćanja se poklapaju.');
});
