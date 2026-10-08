import {beforeEach,expect,it,vi} from 'vitest';
import {createHmac} from 'node:crypto';
const mocks=vi.hoisted(()=>({inspect:vi.fn(),existing:vi.fn(),receipt:vi.fn(),enqueue:vi.fn(),process:vi.fn(),after:vi.fn()}));
vi.mock('next/server',()=>({NextResponse:{json:(body:unknown,init?:ResponseInit)=>Response.json(body,init)},after:mocks.after}));
vi.mock('@/lib/payments/bank-statements.server',()=>({inspectBankEntry:mocks.inspect}));
vi.mock('@/lib/db',()=>({db:{backgroundJob:{findUnique:mocks.existing},payment:{findFirst:mocks.receipt}}}));
vi.mock('@/lib/background-jobs',()=>({enqueueBackgroundJob:mocks.enqueue,processBackgroundJob:mocks.process}));
import {POST} from '@/app/api/integrations/bank-statements/route';
const row={account:'340000100028300451',statement:'225',date:'2099-09-30',bankReference:'FT20999TEST1',orderNumber:'SPC-2099-000001',amountMinor:365200,currency:'RSD'};
const body={sourceHash:'a'.repeat(64),entries:[row]};
function request(payload:unknown,valid=true){const raw=JSON.stringify(payload),timestamp=String(Date.now());return new Request('https://shop.test/api/integrations/bank-statements',{method:'POST',headers:{'x-spc-timestamp':timestamp,'x-spc-signature':valid?createHmac('sha256',process.env.SOCIAL_INTEGRATION_SECRET!).update(`${timestamp}.${raw}`).digest('hex'):'bad'},body:raw});}
beforeEach(()=>{vi.resetAllMocks();process.env.SOCIAL_INTEGRATION_SECRET='a'.repeat(64);mocks.inspect.mockResolvedValue({decision:'MATCHED'});mocks.existing.mockResolvedValue(null);mocks.enqueue.mockResolvedValue({id:'job',status:'QUEUED'});});
it('unsigned bank input cannot queue or inspect an order',async()=>{expect((await POST(request(body,false))).status).toBe(401);expect(mocks.inspect).not.toHaveBeenCalled();expect(mocks.enqueue).not.toHaveBeenCalled();});
it('dry run reports matching without a payment job or mail',async()=>{const response=await POST(request({...body,dryRun:true}));expect(await response.json()).toEqual({ok:true,dryRun:true,results:[{orderNumber:row.orderNumber,decision:'MATCHED'}]});expect(mocks.enqueue).not.toHaveBeenCalled();});
it('valid signed input persists uniquely keyed reconciliation before scheduling',async()=>{expect((await POST(request(body))).status).toBe(200);expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({kind:'BANK_TRANSFER_RECONCILE',idempotencyKey:`bank-credit:${row.account}:${row.bankReference}`}));expect(mocks.after).toHaveBeenCalledOnce();});
it('same reference with modified order or amount is rejected',async()=>{mocks.existing.mockResolvedValue({payload:{...row,sourceHash:body.sourceHash,amountMinor:1}});expect((await POST(request(body))).status).toBe(409);expect(mocks.enqueue).not.toHaveBeenCalled();});
it('completed legacy ledger is validated against payment receipt without another job',async()=>{
 mocks.existing.mockResolvedValue({status:'COMPLETED',payload:{}});
 mocks.receipt.mockResolvedValue({amount:{mul:()=>({equals:(n:number)=>n===row.amountMinor})},rawResponse:{statementDate:row.date}});
 expect((await POST(request(body))).status).toBe(200);expect(mocks.enqueue).not.toHaveBeenCalled();
 expect((await POST(request({...body,entries:[{...row,amountMinor:1}]}))).status).toBe(409);
 expect((await POST(request({...body,entries:[{...row,date:'2099-10-01'}]}))).status).toBe(409);
 mocks.receipt.mockResolvedValue(null);expect((await POST(request(body))).status).toBe(409);
});
it('unreadable PDF submits an internal review only',async()=>{expect((await POST(request({sourceHash:body.sourceHash,rejectedReason:'BANK_CREDIT_TOTAL_MISMATCH'}))).status).toBe(200);expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({kind:'BANK_STATEMENT_REVIEW_EMAIL'}));expect(mocks.inspect).not.toHaveBeenCalled();});
