import { NextRequest, NextResponse } from 'next/server';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { checkRateLimitForRequest, rateLimitJson } from '@/lib/security/rate-limit';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const cookieName='spc_webchat';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function sign(id:string,secret:string){return createHmac('sha256',secret).update('webchat-session:'+id).digest('hex');}
async function handle(req:NextRequest){
 const secret=process.env.SOCIAL_INTEGRATION_SECRET;
 if(!secret)return NextResponse.json({error:'Chat trenutno nije dostupan.'},{status:503});
 const origin=req.headers.get('origin');
 if((origin&&origin!==req.nextUrl.origin)||req.headers.get('sec-fetch-site')==='cross-site')return new NextResponse(null,{status:403});
 const limited=await checkRateLimitForRequest(req,`website-chat-${req.method}`,{limit:req.method==='POST'?15:120,windowMs:60000});
 if(!limited.ok)return rateLimitJson(limited);
 const [saved,proof]= (req.cookies.get(cookieName)?.value??'').split('.');
 const expected=sign(saved??'',secret);
 const valid=uuid.test(saved??'')&&/^[a-f0-9]{64}$/.test(proof??'')&&timingSafeEqual(Buffer.from(expected),Buffer.from(proof));
 // A POST must use the session established by GET, keeping ambiguous retries in one conversation.
 if(req.method==='POST'&&!valid)return NextResponse.json({error:'Otvorite chat ponovo.'},{status:409});
 const id=valid?saved:randomUUID();
 const url=new URL('/webchat','https://spc-chatbot-production.up.railway.app');url.searchParams.set('session',id);
 let body:string|undefined;
 if(req.method==='POST'){
  if(Number(req.headers.get('content-length')??0)>8192)return new NextResponse(null,{status:413});
  body=await req.text();if(Buffer.byteLength(body)>8192)return new NextResponse(null,{status:413});
  let input;try{input=JSON.parse(body);}catch{return new NextResponse(null,{status:400});}
  if(!uuid.test(input?.id??'')||typeof input.text!=='string'||!input.text.trim()||input.text.length>2000)return new NextResponse(null,{status:400});
  body=JSON.stringify({id:input.id,text:input.text});
 }
 try{
  const upstream=await fetch(url,{method:req.method,headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
  const data=await upstream.json();const response=NextResponse.json(data,{status:upstream.status,headers:{'Cache-Control':'no-store'}});
  response.cookies.set(cookieName,`${id}.${sign(id,secret)}`,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:30*86400,path:'/api/chat'});
  return response;
 }catch{return NextResponse.json({error:'Veza je prekinuta. Pokušajte ponovo.'},{status:503});}
}
export const GET=handle;
export const POST=handle;
