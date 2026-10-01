import 'server-only';
import {trackedDispatch} from '@/lib/email/tracking';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export async function notifyOrderWithoutEmail(order:{id:string;number:string;total:unknown;shipping:unknown;items:{name:string;sku:string;qty:number}[]}){
 const link=`https://www.svetpovoljnihcena.rs/admin/erp/prodajni-nalozi/${encodeURIComponent(order.id)}`;
 const text=[`Nova porudžbina ${order.number} je kreirana.`,`Kupac nije ostavio mejl. Potvrda nije slata kupcu.`,...order.items.map(i=>`${i.name} (${i.sku}) × ${i.qty}`),`Ukupno sa dostavom: ${Number(order.total).toLocaleString('sr-Latn-RS')} din`,`Dostava: ${Number(order.shipping).toLocaleString('sr-Latn-RS')} din`,`Podaci kupca i obrada: ${link}`].join('\n');
 const result=await trackedDispatch({kind:'order_without_customer_email',to:'porudzbine@svetpovoljnihcena.rs',subject:`Nova porudžbina ${order.number} — kupac bez mejla`,text,html:`<div style="white-space:pre-wrap">${escape(text)}</div><p><a href="${escape(link)}">Otvori porudžbinu</a></p>`,idempotencyKey:`order-no-email:${order.id}`});
 if(!result.ok||result.provider==='none')throw new Error('INTERNAL_ORDER_EMAIL_FAILED');
}
