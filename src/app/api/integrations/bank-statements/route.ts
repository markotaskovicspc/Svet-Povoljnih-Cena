import {after,NextResponse} from 'next/server';
import {z} from 'zod';
import {verifySocialRequest} from '@/lib/social/security';
import {bankEntrySchema,bankEntryKey} from '@/lib/payments/bank-statements';
import {inspectBankEntry} from '@/lib/payments/bank-statements.server';
import {enqueueBackgroundJob,processBackgroundJob} from '@/lib/background-jobs';
import {db} from '@/lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const schema=z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/),entries:z.array(bankEntrySchema.omit({sourceHash:true})).max(100),dryRun:z.boolean().default(false)});
const rejectedSchema=z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/),rejectedReason:z.string().regex(/^BANK_[A-Z_]{1,80}$/)});
export async function POST(req:Request){
 const raw=await req.text();
 if(raw.length>100000||!verifySocialRequest(raw,req.headers.get('x-spc-timestamp')??'',req.headers.get('x-spc-signature')??'',process.env.SOCIAL_INTEGRATION_SECRET??''))return new Response(null,{status:401});
 let json;try{json=JSON.parse(raw);}catch{return NextResponse.json({ok:false,error:'INVALID_BANK_STATEMENT'},{status:400});}
 const rejected=rejectedSchema.safeParse(json);
 if(rejected.success){const {sourceHash,rejectedReason}=rejected.data;const job=await enqueueBackgroundJob({kind:'BANK_STATEMENT_REVIEW_EMAIL',payload:{sourceHash,reason:rejectedReason},idempotencyKey:`bank-statement-review-job:${sourceHash}`});after(()=>processBackgroundJob(job.id));return NextResponse.json({ok:true,status:job.status});}
 let input;try{input=schema.parse(json);}catch{return NextResponse.json({ok:false,error:'INVALID_BANK_STATEMENT'},{status:400});}
 const results=[];const jobIds:string[]=[];
 for(const row of input.entries){
  const entry={...row,sourceHash:input.sourceHash};
  if(input.dryRun){const {decision}=await inspectBankEntry(entry);results.push({orderNumber:entry.orderNumber,decision});continue;}
  const key=bankEntryKey(entry);
  const existing=await db.backgroundJob.findUnique({where:{idempotencyKey:key},select:{payload:true}});
  if(existing){const saved=bankEntrySchema.safeParse(existing.payload);if(!saved.success||saved.data.amountMinor!==entry.amountMinor||saved.data.orderNumber!==entry.orderNumber||saved.data.date!==entry.date)return NextResponse.json({ok:false,error:'BANK_REFERENCE_CONFLICT'},{status:409});}
  const job=await enqueueBackgroundJob({kind:'BANK_TRANSFER_RECONCILE',payload:entry,idempotencyKey:key});jobIds.push(job.id);
  results.push({orderNumber:entry.orderNumber,status:job.status});
 }
 after(async()=>{for(const id of jobIds)await processBackgroundJob(id).catch(()=>console.error('bank.reconciliation_retry_pending'));});
 return NextResponse.json({ok:true,dryRun:input.dryRun,results},{headers:{'Cache-Control':'no-store'}});
}
