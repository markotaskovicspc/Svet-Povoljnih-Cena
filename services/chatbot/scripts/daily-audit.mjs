// Read-only collector for the Codex daily review. No OpenAI calls, messages or ERP writes.
import {mkdir,writeFile,readdir,stat,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const base='https://spc-chatbot-production.up.railway.app';
const token=process.env.CHAT_ADMIN_TOKEN;
if(!token)throw Error('CHAT_ADMIN_TOKEN is missing');
const to=new Date(),from=new Date(+to-24*3600000);
const dir=resolve('tmp/daily-audit');await mkdir(dir,{recursive:true});
const conversations=new Map();let cursor=null,pages=0,total=0;
do{
 const url=new URL('/admin/audit',base);url.searchParams.set('from',from.toISOString());url.searchParams.set('to',to.toISOString());if(cursor)url.searchParams.set('cursor',cursor);
 const r=await fetch(url,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error(`Audit API HTTP ${r.status}`);
 const data=await r.json();
 for(const record of data.records){const group=conversations.get(record.conversation)??[];group.push(record);conversations.set(record.conversation,group);total++;}
 cursor=data.nextCursor;pages++;
 if(pages>1000)throw Error('Audit exceeds safety limit; report incomplete coverage');
}while(cursor);
const run=to.toISOString().replace(/[:.]/g,'-'),index=[];
for(const [conversation,messages] of conversations){
 const key=createHash('sha256').update(conversation).digest('hex').slice(0,16),file=`${run}-${key}.json`;
 await writeFile(resolve(dir,file),JSON.stringify({conversation,link:`${base}/?conversation=${encodeURIComponent(conversation)}`,messages},null,2));
 index.push({key,file,messages:messages.length,channel:messages[0].channel,failed:messages.filter(m=>m.status==='failed').length});
}
const manifest={from:from.toISOString(),to:to.toISOString(),complete:true,pages,messages:total,conversations:index.length,scope:'Facebook and Instagram saved inbound messages and outbound queue; not email mailbox. Staff and bot messages are distinguished; pending/failed outbound text is not delivered text.',privacy:'Contact masking is best effort, not anonymization. Do not quote personal contact data in reports.',context:'For ambiguous findings, consult the protected conversation panel/history before concluding. No automatic fixes or writes.',files:index};
await writeFile(resolve(dir,'latest.json'),JSON.stringify(manifest,null,2));
// Local review extracts are temporary; delete only collector-owned old JSON files.
for(const file of await readdir(dir))if(/^\d{4}-\d\d-\d\dT[\dTZ-]+-[a-f0-9]{16}\.json$/.test(file)&&Date.now()-(await stat(resolve(dir,file))).mtimeMs>7*86400000)await rm(resolve(dir,file));
console.log(JSON.stringify({manifest:resolve(dir,'latest.json'),complete:true,pages,messages:total,conversations:index.length}));
