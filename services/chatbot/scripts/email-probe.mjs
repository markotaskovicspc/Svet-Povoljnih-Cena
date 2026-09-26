import {ImapFlow} from 'imapflow';
import {composeDraft,draftMessageId} from '../src/email-drafts.mjs';
import {randomUUID} from 'node:crypto';
if(!process.env.EMAIL_IMAP_PASSWORD){console.log(JSON.stringify({ok:false,status:'waiting_for_password'}));process.exit(2);}
const client=new ImapFlow({host:'mail.svetpovoljnihcena.rs',port:993,secure:true,auth:{user:'podrska@svetpovoljnihcena.rs',pass:process.env.EMAIL_IMAP_PASSWORD},logger:false,tls:{rejectUnauthorized:true},connectionTimeout:15000,greetingTimeout:15000});
client.on('error',()=>{});
try{
 await client.connect();const boxes=await client.list();const drafts=boxes.find(b=>b.specialUse==='\\Drafts')?.path??boxes.find(b=>/^(?:INBOX[./])?(?:Drafts|Nacrti)$/i.test(b.path))?.path;
 if(!drafts)throw Error('NO_DRAFTS');
 let verified=false;
 if(process.argv.includes('--draft')){
  const key='connection-test-'+randomUUID();
  const mime=await composeDraft({sender:'podrska@svetpovoljnihcena.rs',subject:'TEST — SPC automatski nacrti',text:'Provera povezivanja. Ovaj mejl nije poslat.',references:[]},'Ovo je probni nacrt za proveru čuvanja u webmail-u. Servis ne šalje mejlove. Ovaj nacrt možete obrisati.',key);
  await client.append(drafts,mime,['\\Draft']);await client.mailboxOpen(drafts,{readOnly:true});
  verified=(await client.search({header:{'message-id':draftMessageId(key)}},{uid:true})).length===1;
 }
 console.log(JSON.stringify({ok:true,imapTls:client.secureConnection,draftsFolder:drafts,probeDraftVerified:verified,smtpUsed:false}));
}catch{console.log(JSON.stringify({ok:false,status:'imap_probe_failed'}));process.exitCode=1;}
finally{await client.logout().catch(()=>client.close());}
