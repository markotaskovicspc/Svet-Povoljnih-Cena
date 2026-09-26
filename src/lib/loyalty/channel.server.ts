import "server-only";
import {createHash, randomUUID} from "node:crypto";
import {z} from "zod";
import {db} from "@/lib/db";
import {signSocialQuote,readSocialQuote} from "@/lib/social/security";
import {LOYALTY_CONSENT_VERSION} from "./shared";

const scopeSchema=z.object({channel:z.enum(['facebook','instagram','email']),conversationId:z.string().min(3).max(200),email:z.email()});
type Scope=z.infer<typeof scopeSchema>;
const tokenSchema=scopeSchema.extend({purpose:z.enum(['loyalty_invitation','loyalty_access']),version:z.string(),nonce:z.string(),expiresAt:z.number(),consentAt:z.string().optional()});
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const normalized=(scope:Scope)=>({...scope,email:scope.email.trim().toLowerCase()});
const duration=30*24*60*60*1000;
export const loyaltySummary=(email:string)=>`Loyalty pogodnosti za ${email}: 30% popusta na artikle koji nisu na aktivnoj akciji. Za prvu kupovinu dodatnih 15% na artikle, ako ERP potvrdi pravo; dostava se ne umanjuje. Konačan iznos dobijate u ponudi.\nPristup je dobrovoljan. Čuvamo mejl, vreme i verziju saglasnosti radi članstva i obračuna pogodnosti. Ovo nije prijava za reklamne poruke.\nIzjava i prava: https://www.svetpovoljnihcena.rs/loyalty/uslovi\nOdgovorite DA ako prihvatate izjavu i želite loyalty pogodnosti. Ovim ne potvrđujete porudžbinu. Za kupovinu bez članstva odgovorite NE.`;
export function prepareChannelLoyalty(raw:Scope,secret:string){
 const scope=normalized(scopeSchema.parse(raw)),expiresAt=Date.now()+24*60*60*1000;
 return {ok:true as const,email:scope.email,summary:loyaltySummary(scope.email),expiresAt,challenge:signSocialQuote({...scope,purpose:'loyalty_invitation',version:LOYALTY_CONSENT_VERSION,nonce:randomUUID(),expiresAt},secret)};
}
function read(token:string,raw:Scope,secret:string,purpose:string){
 try{
  const data=tokenSchema.parse(readSocialQuote(token,secret)),scope=normalized(raw);
  if(data.purpose!==purpose||data.version!==LOYALTY_CONSENT_VERSION||data.channel!==scope.channel||data.conversationId!==scope.conversationId||data.email!==scope.email)return null;
  return data;
 }catch{return null;}
}
export async function acceptChannelLoyalty(challenge:string,scope:Scope,secret:string){
 const data=read(challenge,scope,secret,'loyalty_invitation');
 if(!data)return null;
 const token=digest('channel-loyalty:'+data.nonce),identifier=`loyalty-channel:${digest(JSON.stringify(normalized(scope)))}:${data.version}`;
 let record=await db.verificationToken.findUnique({where:{token}});
 if(!record){
  if(data.expiresAt<Date.now())return null;
  record=await db.$transaction(async tx=>{
   const record=await tx.verificationToken.upsert({where:{token},create:{token,identifier,expires:new Date(Date.now()+duration)},update:{}});
   const consentAt=new Date(record.expires.getTime()-duration);
   await tx.guestLoyaltyMembership.upsert({where:{email:data.email},create:{email:data.email,consentVersion:data.version,consentAt},update:{consentVersion:data.version,consentAt}});
   return record;
  });
 }
 if(record.identifier!==identifier||record.expires.getTime()<Date.now())return null;
 const member=await db.guestLoyaltyMembership.findUnique({where:{email:data.email}});
 if(!member||member.consentVersion!==data.version)return null;
 const expiresAt=record.expires.getTime(),consentAt=new Date(expiresAt-duration).toISOString();
 return {email:data.email,expiresAt,proof:signSocialQuote({...data,purpose:'loyalty_access',expiresAt,consentAt},secret)};
}
export async function channelLoyalty(proof:string|undefined,scope:Scope,secret:string){
 if(!proof)return null;
 const data=read(proof,scope,secret,'loyalty_access');
 if(!data||data.expiresAt<Date.now()||!data.consentAt)return null;
 const record=await db.verificationToken.findUnique({where:{token:digest('channel-loyalty:'+data.nonce)}});
 const member=await db.guestLoyaltyMembership.findUnique({where:{email:data.email}});
 if(!record||record.expires.getTime()!==data.expiresAt||!member||member.consentVersion!==data.version)return null;
 return {email:data.email,consentVersion:data.version,consentAt:new Date(data.consentAt)};
}
