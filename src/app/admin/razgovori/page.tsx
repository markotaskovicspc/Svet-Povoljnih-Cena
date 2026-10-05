import Link from 'next/link';
import {requireAdminAction} from '@/lib/admin';
import {PageHeader} from '@/components/admin/page-header';
import {Card} from '@/components/admin/card';
export const dynamic='force-dynamic';
export const metadata={title:'Razgovori · SPC',robots:{index:false,follow:false}};
type Message={id:string,source:string,status:string,timestamp:number,text:string,attachments:{url:string}[]};
type Conversation={id:string,channel:string,paused:boolean,reason:string|null,name:string|null,preview:string,needsSupport:boolean};
type Detail=Conversation&{history:Message[],context:{role:string,content:string,timestamp?:number}[],orders:{number:string}[],support:{id:string,status:string,reason:string}[],nextOffset:number|null};
async function read<T>(path:string):Promise<T>{
 const secret=process.env.SOCIAL_INTEGRATION_SECRET;
 if(!secret||secret.length<32||secret.startsWith('GET_FROM_'))throw Error('CHAT_UNAVAILABLE');
 const response=await fetch(new URL(path,'https://spc-chatbot-production.up.railway.app'),{headers:{authorization:`Bearer ${secret}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('CHAT_UNAVAILABLE');return response.json();
}
const first=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;
const label=(channel:string)=>channel==='web'?'Sajt':channel==='instagram'?'Instagram':'Facebook';
const statuses:Record<string,string>={sent:'Poslato',done:'Obrađeno',pending:'Čeka obradu/slanje',failed:'Neuspešna obrada/slanje',skipped:'Preskočeno',recorded:'Zabeleženo u panelu — bez novog mejla',superseded:'Rešeno / zamenjeno'};
export default async function ConversationsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 await requireAdminAction(['OPS']);const params=await searchParams;
 const selected=first(params.conversation),requested=first(params.channel),channel=['facebook','instagram','web'].includes(requested??'')?requested:'';
 const offset=Number(first(params.offset)??0),historyOffset=Number(first(params.historyOffset)??0);
 const listOffset=Number.isSafeInteger(offset)&&offset>=0&&offset<=1000000?offset:0;
 const messageOffset=Number.isSafeInteger(historyOffset)&&historyOffset>=0&&historyOffset<=1000000?historyOffset:0;
 let list:{items:Conversation[],nextOffset:number|null}|null=null,detail:Detail|null=null,error=false;
 try{[list,detail]=await Promise.all([read<{items:Conversation[],nextOffset:number|null}>(`/operator/conversations?offset=${listOffset}${channel?'&channel='+channel:''}`),selected&&selected.length<=200?read<Detail>('/operator/conversation?id='+encodeURIComponent(selected)+'&offset='+messageOffset):Promise.resolve(null)]);}catch{error=true;}
 const href=(extra:Record<string,string|number>)=>'/admin/razgovori?'+new URLSearchParams({...(channel?{channel}:{}),offset:String(listOffset),...(selected?{conversation:selected}:{}),...Object.fromEntries(Object.entries(extra).map(([k,v])=>[k,String(v)]))}).toString();
 return <><PageHeader title="Razgovori kupaca" description="Facebook, Instagram i chat sa sajta. Tačna prepiska, porudžbine i zahtevi podršci." crumbs={[{href:'/admin',label:'Admin'},{label:'Razgovori'}]}/><div className="space-y-4 px-4 py-6 md:px-8">
 <form method="get" className="flex flex-wrap items-center gap-3"><label>Kanal <select name="channel" defaultValue={channel} className="rounded-lg border border-border p-2"><option value="">Svi kanali</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="web">Sajt</option></select></label><button className="rounded-lg border border-border px-4 py-2">Prikaži</button><Link className="underline" href={href({})}>Osveži</Link></form>
 {error&&<p role="alert">Razgovori trenutno nisu dostupni. Pokušajte ponovo; postojeće poruke su sačuvane.</p>}
 <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]"><Card><h2 className="mb-3 font-semibold">Razgovori</h2><p className="mb-3 text-xs text-ink-500">Prikaz {listOffset+1}–{listOffset+(list?.items.length??0)}. Za ostale razgovore otvorite sledeću stranu.</p><ul className="space-y-2">{list?.items.map(row=><li key={row.id}><Link href={href({conversation:row.id,historyOffset:0})} className={`block rounded-lg border p-3 ${selected===row.id?'border-brand-blue bg-blue-50':'border-border'}`}><strong className="block">{row.name||`${label(row.channel)} kupac ${row.id.split(':').at(-1)?.slice(-8)}`}</strong><span className="text-xs">{label(row.channel)} · {row.paused?'Bot pauziran':'Bot aktivan'}{row.needsSupport?' · Podrška':''}</span><p className="mt-1 line-clamp-2 break-words text-sm text-ink-500">{row.preview}</p></Link></li>)}</ul><div className="mt-4 flex gap-4">{listOffset>0&&<Link className="underline" href={href({offset:Math.max(0,listOffset-50)})}>Prethodni</Link>}{list?.nextOffset!=null&&<Link className="underline" href={href({offset:list.nextOffset})}>Sledeći razgovori</Link>}</div></Card>
 <Card>{detail?<><h2 className="font-semibold">{detail.name||'Razgovor kupca'} · {label(detail.channel)}</h2><p className="mt-2 text-sm">{detail.paused?'Bot pauziran: '+(detail.reason??''):'Bot aktivan'}</p>{detail.orders.length>0&&<p className="mt-2">Porudžbine: {detail.orders.map(o=>o.number).join(', ')}</p>}
 {detail.support.length>0&&<details className="my-4 rounded-lg border border-border p-3"><summary>Zahtevi korisničkoj podršci ({detail.support.length})</summary>{detail.support.map(item=><p className="mt-2 text-sm" key={item.id}>{statuses[item.status]||item.status}: {item.reason}</p>)}</details>}
 {detail.context.length>0&&<details className="my-4 rounded-lg border border-border p-3"><summary>Sačuvani kontekst razgovora, uključujući uvezene poruke</summary>{detail.context.map((m,i)=><p key={i} className="my-2 whitespace-pre-wrap break-words text-sm"><strong>{m.role==='user'?'Kupac':'SPC (iz konteksta)'}: </strong>{m.content}</p>)}</details>}
 <div className="space-y-3">{detail.history.map(m=><article key={m.id} className={`rounded-lg p-3 ${m.source==='Kupac'?'bg-slate-100':'bg-green-50'}`}><p className="text-xs text-ink-500">{m.source} · {statuses[m.status]||m.status} · {new Date(m.timestamp).toLocaleString('sr-Latn-RS',{timeZone:'Europe/Belgrade'})}</p><p className="mt-1 whitespace-pre-wrap break-words">{m.text}</p>{m.attachments.map((a,i)=><a key={i} className="mr-3 underline" href={a.url} target="_blank" rel="noopener noreferrer">Prilog kupca</a>)}</article>)}</div>
 <div className="mt-4 flex gap-4">{messageOffset>0&&<Link className="underline" href={href({historyOffset:Math.max(0,messageOffset-100)})}>Novije poruke</Link>}{detail.nextOffset!=null&&<Link className="underline" href={href({historyOffset:detail.nextOffset})}>Starije poruke</Link>}</div><p className="mt-4 text-xs text-ink-500">Prikazane su poruke koje je SPC servis primio ili uvezao. Za odgovaranje koristite Business Suite ili postojeći operaterski panel.</p></>:<p>Izaberite razgovor ili otvorite tačnu prepisku iz mejla podrške.</p>}</Card></div></div></>;
}
