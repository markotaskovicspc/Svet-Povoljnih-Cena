import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma} from '@prisma/client';
import {bankEntrySchema,bankPaymentDecision} from '@/lib/payments/bank-statements';
const mocks=vi.hoisted(()=>({order:vi.fn(),previous:vi.fn(),update:vi.fn(),create:vi.fn(),orderUpdate:vi.fn(),event:vi.fn(),enqueue:vi.fn(),lock:vi.fn()}));
vi.mock('@/lib/background-jobs',()=>({enqueueBackgroundJob:mocks.enqueue}));
vi.mock('@/lib/db',()=>({db:{$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:mocks.lock,order:{findUnique:mocks.order,update:mocks.orderUpdate},payment:{findFirst:mocks.previous,update:mocks.update,create:mocks.create},orderStatusEvent:{create:mocks.event}})}}));
import {reconcileBankEntry} from '@/lib/payments/bank-statements.server';
const entry=bankEntrySchema.parse({account:'340000100028300451',statement:'225',date:'2026-09-30',bankReference:'FT26273LJRRX',orderNumber:'SPC-2026-001139',amountMinor:365200,currency:'RSD',sourceHash:'a'.repeat(64)});
const order=()=>({id:'order-id',number:entry.orderNumber,total:new Prisma.Decimal('3652'),status:'KREIRANO',paymentMethod:'UPLATA_NA_RACUN',stockRestoredAt:null,cancelledAt:null,payments:[{id:'payment-id',status:'PENDING',method:'UPLATA_NA_RACUN',provider:'MANUAL'}],supplierFulfillments:[]});
beforeEach(()=>{vi.resetAllMocks();mocks.order.mockResolvedValue(order());mocks.previous.mockResolvedValue(null);mocks.enqueue.mockResolvedValue({id:'job'});});
describe('bank reconciliation',()=>{
 it('marks exact full bank payment paid, confirms order and queues email in transaction',async()=>{
  expect(await reconcileBankEntry(entry)).toEqual(['job']);expect(mocks.lock).toHaveBeenCalledTimes(2);expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({where:{id:'payment-id'},data:expect.objectContaining({status:'PAID',providerRef:entry.bankReference})}));expect(mocks.orderUpdate).toHaveBeenCalledWith({where:{id:'order-id'},data:{status:'POTVRDJENO',expiresAt:null}});expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({kind:'BANK_PAYMENT_EMAIL'}),expect.anything());
 });
 it.each(['AMOUNT_MISMATCH','PAYMENT_METHOD_MISMATCH','ORDER_CANCELLED_OR_RETURNED','PAYMENT_ALREADY_RECORDED','ORDER_NOT_FOUND'])('requires review without a paid state or customer confirmation: %s',async(reason)=>{
  const o=order();if(reason==='AMOUNT_MISMATCH')o.total=new Prisma.Decimal('3653');if(reason==='PAYMENT_METHOD_MISMATCH')o.paymentMethod='POUZECE_GOTOVINA';if(reason==='ORDER_CANCELLED_OR_RETURNED')o.status='OTKAZANO';if(reason==='PAYMENT_ALREADY_RECORDED')o.payments[0].status='PAID';mocks.order.mockResolvedValue(reason==='ORDER_NOT_FOUND'?null:o);
  await reconcileBankEntry(entry);expect(mocks.update).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();expect(mocks.orderUpdate).not.toHaveBeenCalled();expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({kind:'BANK_PAYMENT_REVIEW_EMAIL',payload:expect.objectContaining({reason})}),expect.anything());
 });
 it('replayed same bank reference does not create second payment, event or email',async()=>{
  mocks.previous.mockResolvedValue({orderId:'order-id',amount:new Prisma.Decimal('3652')});expect(await reconcileBankEntry(entry)).toEqual([]);expect(mocks.update).not.toHaveBeenCalled();expect(mocks.enqueue).not.toHaveBeenCalled();expect(mocks.event).not.toHaveBeenCalled();
 });
 it('same reference attached to another order alerts support',async()=>{
  mocks.previous.mockResolvedValue({orderId:'other',amount:new Prisma.Decimal('3652')});await reconcileBankEntry(entry);expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({payload:expect.objectContaining({reason:'BANK_REFERENCE_CONFLICT'})}),expect.anything());expect(mocks.update).not.toHaveBeenCalled();
 });
 it('partial payment cannot be labelled full payment',()=>{expect(bankPaymentDecision({...order(),totalMinor:400000},entry)).toBe('AMOUNT_MISMATCH');});
});
