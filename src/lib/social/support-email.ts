type Support = {channel?:string;conversationId?:string;reason:string;transcript:string;customerName?:string;conversationLink?:string;inboxUrl?:string;reclamationId?:string};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export function supportEmail(body:Support){
 const reason=body.transcript.match(/^RAZLOG: ([^\n]+)/)?.[1]??body.reason;
 const failedOrder=body.transcript.startsWith('RAZLOG:')||/porud[zž]bina|loyalty|ponud/i.test(reason);
 const heading=failedOrder?'Potrebna pomoć za završetak porudžbine':'Kupac čeka odgovor podrške';
 const web=body.channel==='web';
 const action=web?'Procitajte razgovor sa sajta u SPC-u; za odgovor koristite operaterski panel. Ako porudzbina vec postoji, nemojte praviti novu.':failedOrder?'Proverite da li porudžbina već postoji u ERP-u. Ako postoji, nemojte praviti novu. Ako ne postoji, rešite navedenu prepreku i završite dogovor.':'Pročitajte zahtev ispod i odgovorite kupcu u Business Suite-u.';
 const link=web&&/^web:spc:[0-9a-f-]{36}$/i.test(body.conversationId??'')?`https://spc-chatbot-production.up.railway.app/?conversation=${encodeURIComponent(body.conversationId!)}`:body.conversationLink??body.inboxUrl;
 const linkLabel=web?'Otvori razgovor sa sajta u SPC panelu':body.conversationLink?'Otvori razgovor u Business Suite-u':'Otvori Business Suite inbox';
 const find=!web&&!body.conversationLink?(body.customerName?`U pretrazi inboxa unesite: ${body.customerName}`:'Izaberite razgovor kupca u inboxu.') :'';
 const panel=/^(facebook|instagram|web):[A-Za-z0-9:_-]{1,180}$/.test(body.conversationId??'')?`https://www.svetpovoljnihcena.rs/admin/razgovori?conversation=${encodeURIComponent(body.conversationId!)}`:null;
 const transcript=body.transcript.replace(/^RAZLOG: [^\n]+\n/,'');
 const text=[heading,body.customerName?`Kupac: ${body.customerName}`:'',`Šta je zapelo: ${reason}`,`Sledeći korak: ${action}`,panel?`Otvori tačnu prepisku u SPC-u: ${panel}`:'',link&&!web?`${linkLabel}: ${link}`:'',find,'Dogovor i poslednje poruke:',transcript].filter(Boolean).join('\n\n');
 const html=`<h2>${escape(heading)}</h2>${body.customerName?`<p>Kupac: <strong>${escape(body.customerName)}</strong></p>`:''}<p><strong>Šta je zapelo:</strong><br>${escape(reason)}</p><p><strong>Sledeći korak:</strong><br>${escape(action)}</p>${panel?`<p><a href="${escape(panel)}">Otvori tačnu prepisku u SPC-u</a></p>`:''}${link&&!web?`<p><a href="${escape(link)}">${linkLabel}</a></p>`:''}${find?`<p>${escape(find)}</p>`:''}<h3>Dogovor i poslednje poruke</h3><div style="white-space:pre-wrap;font-family:Arial,sans-serif;line-height:1.5">${escape(transcript)}</div>`;
 return {subject:`SPC — ${heading}${body.customerName?`: ${body.customerName}`:''}`,text,html};
}

