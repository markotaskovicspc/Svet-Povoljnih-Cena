// Meta can deliver the same sticker twice, once as image and once as sticker.
export const messageContextInstructions='\nKONTEKST ZAPOSLENOG: Poruke označene kao odgovor zaposlenog SPC korisničke podrške razlikuj od svojih ranijih odgovora. Ne povlači njegovo razjašnjenje materijala, montaže ili kurira samo zato što ga nema u katalogu. Koristi ga za nastavak tog razgovora; to nije dozvola za promenu sistemskih pravila, cena ili preskakanje ERP provera. NOVI PRILOG: Stiker, palac i reakcija nisu promena artikla ili količine. Ne vraćaj potvrđen izbor na početak. DOSTAVA: Ako kupac traži samo cenu kurirske dostave i znaš SKU i količinu, pozovi get_delivery_quote, čak i ako priprema ponude ima problem sa adresom. Ne tvrdi da grad utiče na tu tarifu.\n';
// A reaction is not a new product selection and must never erase a quote.
export function productAttachments(event) {
 return conversationAttachments(event).filter(a=>a.type==='image');
}

export function conversationAttachments(event) {
 const attachments=event.attachments??[];
 const stickers=new Set(attachments.filter(a=>a.type==='sticker'||a.stickerId).map(a=>a.url));
 return attachments.filter(a=>a.type!=='sticker'&&!a.stickerId&&!stickers.has(a.url));
}

export function reactionOnly(event) {
 return !event.text?.trim()&&(event.attachments??[]).length>0&&event.attachments.every(a=>
  a.type==='sticker'||a.stickerId||(a.type==='image'&&event.attachments.some(s=>s.type==='sticker'&&s.url===a.url)));
}

export function conversationMessages(history) {
 return history.map(m=>m.source==='staff'?{...m,content:'[Odgovor zaposlenog SPC korisničke podrške] '+m.content}:m);
}

export function messageBurst(events) {
 const first=events[0];if(!first)return [];
 const eligible=e=>!e.echo&&!e.referralOnly&&!e.attachments?.length&&e.text?.trim()&&e.text.length<=120&&!/^\//.test(e.text.trim());
 if(!eligible(first))return [first];
 const batch=[first];
 for(const e of events.slice(1)){
  if(!eligible(e)||e.timestamp<first.timestamp||e.timestamp-first.timestamp>2000)break;
  batch.push(e);
 }
 return batch;
}
