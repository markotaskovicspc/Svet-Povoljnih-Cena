import {after,NextResponse} from 'next/server';
import {verifySocialRequest} from '@/lib/social/security';
import {emailActionSchema,handleEmailAction} from '@/lib/social/email-actions';
import {db} from '@/lib/db';
import {checkoutFollowUpKey} from '@/lib/checkout/outbox';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 const raw=await req.text(),secret=process.env.SOCIAL_INTEGRATION_SECRET??'';
 if(raw.length>40000||!verifySocialRequest(raw,req.headers.get('x-spc-timestamp')??'',req.headers.get('x-spc-signature')??'',secret))return new Response(null,{status:401});
 let input;try{input=emailActionSchema.parse(JSON.parse(raw));}catch{return NextResponse.json({ok:false,error:{code:'INVALID_EMAIL_ACTION'}},{status:400});}
 const result=await handleEmailAction(input,secret);
 if(result.ok&&'orderId' in result&&typeof result.orderId==='string'&&result.kind==='purchase'){
  const orderId=result.orderId;
  after(async()=>{try{const job=await db.backgroundJob.findUnique({where:{idempotencyKey:checkoutFollowUpKey(orderId)},select:{id:true}});if(job){const {processBackgroundJob}=await import('@/lib/background-jobs');await processBackgroundJob(job.id);}}catch{console.error('email.checkout_follow_up_failed');}});
 }
 return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
}
