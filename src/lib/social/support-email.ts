type Support = {channel?:string;conversationId?:string;callbackEmail?:string;reason:string;transcript:string;customerName?:string;conversationLink?:string;inboxUrl?:string;reclamationId?:string};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
// Comment handoffs carry the webhook ID and a server-written source header.
// A public comment is not a private chat and cannot be selected in ERP.
function commentContext(body:Support){
 const id=body.conversationId??'';
 if(!id.startsWith('comment:'))return null;
 const identity=id.match(/^comment:(facebook|instagram):(\d+):(\d+(?:_\d+)?)$/);
 const source=body.transcript.match(/^Objava (\d+(?:_\d+)?); komentar (\d+(?:_\d+)?)\r?\n/);
 if(!identity||identity[1]!=='facebook'||!source||source[2]!==identity[3])return {link:null};
 const [account,comment]=identity.slice(2);
 const post=source[1].split('_');
 if(post.length===2&&post[0]!==account)return {link:null};
 const link=new URL('https://www.facebook.com/permalink.php');
 link.searchParams.set('story_fbid',post.at(-1)!);
 link.searchParams.set('id',account);
 link.searchParams.set('comment_id',comment.split('_').at(-1)!);
 return {link:link.href};
}
export function supportEmail(body:Support){
 const reason=body.transcript.match(/^RAZLOG: ([^\n]+)/)?.[1]??body.reason;
 const failedOrder=body.transcript.startsWith('RAZLOG:')||/porud[zž]bina|loyalty|ponud/i.test(reason);
 const heading=failedOrder?'Potrebna pomoć za završetak porudžbine':'Kupac čeka odgovor podrške';
 const comment=commentContext(body);
 const nextStep=comment
  ? comment.link
   ? 'Otvorite komentar na Facebook-u i odgovorite na zahtev kupca. Ovo je komentar na objavi; privatna prepiska možda još ne postoji.'
   : 'Pronađite komentar na izvornoj objavi u Facebook-u ili Instagram-u i odgovorite na zahtev kupca. Ovo je komentar na objavi; privatna prepiska možda još ne postoji.'
  : body.callbackEmail
   ? 'Javite se kupcu na navedeni mejl. Sažetak i razgovor su dostupni u ERP-u.'
   : 'Otvorite razgovor u ERP-u, kliknite „Preuzmi razgovor“ i odgovorite kupcu.';
 const action=nextStep+(failedOrder?' Najpre proverite da li porudžbina već postoji. Ako postoji, nemojte praviti novu. Ako ne postoji, rešite navedenu prepreku i završite dogovor.':'');
 const panel=comment?comment.link:/^(facebook|instagram|web):[A-Za-z0-9:_-]{1,180}$/.test(body.conversationId??'')?`https://www.svetpovoljnihcena.rs/admin/razgovori?conversation=${encodeURIComponent(body.conversationId!)}`:'https://www.svetpovoljnihcena.rs/admin/razgovori';
 const linkLabel=comment?'Otvori ovaj komentar na Facebook-u':panel?.includes('?')?'Otvori ovaj razgovor u ERP-u':'Otvori ERP razgovore';
 const transcript=body.transcript.replace(/^RAZLOG: [^\n]+\n/,'');
 const text=[heading,body.customerName?`Kupac: ${body.customerName}`:'',body.callbackEmail?`Mejl za odgovor kupcu: ${body.callbackEmail}`:'',`Šta je zapelo: ${reason}`,`Sledeći korak: ${action}`,panel?`${linkLabel}: ${panel}`:'','Dogovor i poslednje poruke:',transcript].filter(Boolean).join('\n\n');
 const html=`<h2>${escape(heading)}</h2>${body.customerName?`<p>Kupac: <strong>${escape(body.customerName)}</strong></p>`:''}${body.callbackEmail?`<p><strong>Mejl za odgovor kupcu:</strong> ${escape(body.callbackEmail)}</p>`:''}<p><strong>Šta je zapelo:</strong><br>${escape(reason)}</p><p><strong>Sledeći korak:</strong><br>${escape(action)}</p>${panel?`<p><a href="${escape(panel)}">${linkLabel}</a></p>`:''}<h3>Dogovor i poslednje poruke</h3><div style="white-space:pre-wrap;font-family:Arial,sans-serif;line-height:1.5">${escape(transcript)}</div>`;
 return {subject:`SPC — ${heading}${body.customerName?`: ${body.customerName}`:''}`,text,html,...(body.callbackEmail?{replyTo:body.callbackEmail}:{})};
}

