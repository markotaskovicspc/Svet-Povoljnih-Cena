import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticatePartner, partnerRateLimitHeaders } from '@/lib/partners/auth';
import { reclamationReturnReceiptsWhere } from '@/lib/admin/reclamation-refund-notice.server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const input=z.object({id:z.string().min(1).max(100).optional(),number:z.string().min(3).max(100).optional(),emails:z.array(z.email().max(254)).max(10).optional()}).strict().refine(v=>v.id||v.number||v.emails?.length);
/** Separate, bounded lookup: customer PII is never added to the bulk analytics export. */
export async function POST(request:Request){
 const requestId=randomUUID();let headers:Record<string,string>={'Cache-Control':'private, no-store','Vary':'Authorization','X-Request-Id':requestId,'X-Content-Type-Options':'nosniff'};
 try{
  const auth=await authenticatePartner(request,'spcapp:read');
  if(auth.rateLimit)headers={...headers,...Object.fromEntries(new Headers(partnerRateLimitHeaders(auth.rateLimit)))};
  if(!auth.ok)return Response.json({ok:false,error:auth.error,requestId},{status:auth.status,headers});
  const raw=await request.text();if(raw.length>8000)return Response.json({ok:false,error:'Request too large.',requestId},{status:413,headers});
  let body:unknown;try{body=JSON.parse(raw);}catch{return Response.json({ok:false,error:'Invalid JSON.',requestId},{status:400,headers});}
  const parsed=input.safeParse(body);if(!parsed.success)return Response.json({ok:false,error:'Expected claim id, number, or customer emails.',requestId},{status:400,headers});
  const q=parsed.data;
  const where=q.id?{id:q.id}:q.number?{number:{equals:q.number,mode:'insensitive' as const}}:{OR:(q.emails??[]).map(email=>({customerEmail:{equals:email,mode:'insensitive' as const}}))};
  const rows=await db.reclamation.findMany({where,take:21,orderBy:{createdAt:'desc'},select:{
   id:true,number:true,orderItemId:true,sku:true,quantity:true,customerFirst:true,customerLast:true,customerEmail:true,decision:true,resolution:true,requestedDiscountPct:true,type:true,refundWithoutReturnAt:true,status:true,createdAt:true,
   order:{select:{id:true,number:true,status:true,total:true,shipping:true,voucherDiscount:true,firstPurchaseDiscount:true,savedCardDiscount:true,
    items:{select:{id:true,sku:true,name:true,qty:true,unitPriceSale:true,withAssembly:true,assemblyPrice:true}},
    paymentRefunds:{where:{status:{in:['PENDING','COMPLETED','NEEDS_REVIEW']}},select:{id:true,status:true,amount:true}},
   }},
  }});
  // Primljeni komadi u magacin (proknjiženi prijem reklamacije): SPC Analytics pravi QR za povrat tek kad je primljena cela količina (Marko, 12.11.2026).
  const received=await Promise.all(rows.slice(0,20).map(row=>db.stockMovement.aggregate({where:reclamationReturnReceiptsWhere(row.id),_sum:{qty:true}})));
  // refundWithoutReturn: QR bez čekanja prijema (nije isporučeno ili ručno odobreno u ERP-u).
  const items=rows.slice(0,20).map((row,i)=>({...row,receivedQty:Math.max(0,received[i]._sum.qty??0),refundWithoutReturn:row.type==='NIJE_ISPORUCENO'||!!row.refundWithoutReturnAt}));
  await db.auditLog.create({data:{action:'partner.spcapp.reclamation.lookup',entity:'PartnerApiClient',entityId:auth.client.id,diff:{rows:Math.min(rows.length,20),by:q.id?'id':q.number?'number':'email'}}});
  return Response.json({ok:true,apiVersion:'1',items,hasMore:rows.length>20,requestId},{headers});
 }catch{
  return Response.json({ok:false,error:'Reclamation lookup failed.',requestId},{status:502,headers});
 }
}
