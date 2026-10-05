type Support = {channel?:string;conversationId?:string;reason:string;transcript:string;customerName?:string;conversationLink?:string;inboxUrl?:string;reclamationId?:string};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export function supportEmail(body:Support){
 const reason=body.transcript.match(/^RAZLOG: ([^\n]+)/)?.[1]??body.reason;
 const failedOrder=body.transcript.startsWith('RAZLOG:')||/porud[zž]bina|loyalty|ponud/i.test(reason);
 const heading=failedOrder?'Potrebna pomoć za završetak porudžbine':'Kupac čeka odgovor podrške';
 const action='Otvorite razgovor u ERP-u, kliknite „Preuzmi razgovor“ i odgovorite kupcu.'+(failedOrder?' Najpre proverite da li porudžbina već postoji. Ako postoji, nemojte praviti novu. Ako ne postoji, rešite navedenu prepreku i završite dogovor.':'');
 const panel=/^(facebook|instagram|web):[A-Za-z0-9:_-]{1,180}$/.test(body.conversationId??'')?`https://www.svetpovoljnihcena.rs/admin/razgovori?conversation=${encodeURIComponent(body.conversationId!)}`:'https://www.svetpovoljnihcena.rs/admin/razgovori';
 const linkLabel=panel.includes('?')?'Otvori ovaj razgovor u ERP-u':'Otvori ERP razgovore';
 const transcript=body.transcript.replace(/^RAZLOG: [^\n]+\n/,'');
 const text=[heading,body.customerName?`Kupac: ${body.customerName}`:'',`Šta je zapelo: ${reason}`,`Sledeći korak: ${action}`,`${linkLabel}: ${panel}`,'Dogovor i poslednje poruke:',transcript].filter(Boolean).join('\n\n');
 const html=`<h2>${escape(heading)}</h2>${body.customerName?`<p>Kupac: <strong>${escape(body.customerName)}</strong></p>`:''}<p><strong>Šta je zapelo:</strong><br>${escape(reason)}</p><p><strong>Sledeći korak:</strong><br>${escape(action)}</p><p><a href="${escape(panel)}">${linkLabel}</a></p><h3>Dogovor i poslednje poruke</h3><div style="white-space:pre-wrap;font-family:Arial,sans-serif;line-height:1.5">${escape(transcript)}</div>`;
 return {subject:`SPC — ${heading}${body.customerName?`: ${body.customerName}`:''}`,text,html};
}

