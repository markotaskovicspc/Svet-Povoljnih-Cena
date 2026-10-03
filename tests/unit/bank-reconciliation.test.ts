import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({tx:null as any,enqueue:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{$transaction:async(fn:any)=>fn(mocks.tx)}}));
vi.mock('@/lib/background-jobs',()=>({enqueueBackgroundJob:mocks.enqueue}));
import {Prisma} from '@prisma/client';
import {reconcileBankEntry} from '@/lib/payments/bank-statements.server';
const entry={account:'340000100028300451' as const,bankReference:'FT26273LJRRX',statement:'225',date:'2026-09-30',orderNumber:'SPC-2026-001139',amountMinor:365200,currency:'RSD' as const,sourceHash:'a'.repeat(64)};
beforeEach(()=>{
 vi.clearAllMocks();mocks.enqueue.mockResolvedValue({id:'email-job'});
 const order={id:'order',paymentMethod:'UPLATA_NA_RACUN',status:'KREIRANO',total:new Prisma.Decimal(3652),payments:[],supplierFulfillments:[]};
 mocks.tx={$queryRaw:vi.fn(async(sql:any)=>{if(sql.sql.includes('pg_advisory_xact_lock')&&!sql.sql.includes('::text'))throw Error('Failed to deserialize void');return [];}),order:{findUnique:vi.fn(async()=>order),update:vi.fn()},payment:{findFirst:vi.fn(async()=>null),create:vi.fn(),update:vi.fn()},orderStatusEvent:{create:vi.fn()}};
});
it('full matching payment records payment and confirmation once, duplicate reference cannot resend',async()=>{
 expect(await reconcileBankEntry(entry)).toEqual(['email-job']);
 expect(mocks.tx.payment.create).toHaveBeenCalledWith({data:expect.objectContaining({orderId:'order',status:'PAID',providerRef:entry.bankReference,amount:new Prisma.Decimal(3652)})});
 expect(mocks.tx.order.update).toHaveBeenCalledWith({where:{id:'order'},data:{status:'POTVRDJENO',expiresAt:null}});
 expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({kind:'BANK_PAYMENT_EMAIL'}),mocks.tx);
 mocks.tx.payment.findFirst.mockResolvedValue({orderId:'order',amount:new Prisma.Decimal(3652)});
 expect(await reconcileBankEntry(entry)).toEqual([]);
 expect(mocks.tx.payment.create).toHaveBeenCalledTimes(1);expect(mocks.enqueue).toHaveBeenCalledTimes(1);
});
it('amount mismatch creates only support review, never marks order paid',async()=>{
 await reconcileBankEntry({...entry,amountMinor:100});
 expect(mocks.tx.payment.create).not.toHaveBeenCalled();expect(mocks.tx.order.update).not.toHaveBeenCalled();
 expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({kind:'BANK_PAYMENT_REVIEW_EMAIL',payload:expect.objectContaining({reason:'AMOUNT_MISMATCH'})}),mocks.tx);
});
