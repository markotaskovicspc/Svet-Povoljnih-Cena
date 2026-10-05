"use client";
import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
type Message={id:string;role:'user'|'assistant';text:string;imageUrl?:string|null;status:string};
export function MessengerContact(){
 const [open,setOpen]=useState(false),[messages,setMessages]=useState<Message[]>([]),[text,setText]=useState(''),[ready,setReady]=useState(false),[sending,setSending]=useState(false),[error,setError]=useState(''),[support,setSupport]=useState(false);
 const retry=useRef<{id:string;text:string}|null>(null),bottom=useRef<HTMLDivElement>(null);
 const waiting=messages.some(m=>m.role==='user'&&m.status==='pending');
 useEffect(()=>{
  if(!open)return;let alive=true;const controller=new AbortController();
  const refresh=async()=>{try{const r=await fetch('/api/chat',{cache:'no-store',signal:controller.signal});if(!r.ok)throw new Error();const d=await r.json();if(alive){setMessages(d.messages);setSupport(d.needsSupport);setReady(true);setError('');}}catch{if(alive)setError('Chat trenutno nije dostupan. Pokušajte ponovo.');}};
  void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>{alive=false;controller.abort();clearInterval(timer);};
 },[open]);
 useEffect(()=>{bottom.current?.scrollIntoView({block:'nearest'});},[messages]);
 async function send(e:React.FormEvent){
  e.preventDefault();if(!text.trim()||sending||!ready)return;
  const input=retry.current?.text===text.trim()?retry.current:{id:crypto.randomUUID(),text:text.trim()};retry.current=input;setSending(true);setError('');
  try{const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error();setMessages(old=>old.some(m=>m.id.endsWith(input.id))?old:[...old,{id:input.id,role:'user',text:input.text,status:'pending'}]);setText('');retry.current=null;}
  catch{setError('Slanje nije potvrđeno. Pokušajte ponovo istom porukom.');}
  finally{setSending(false);}
 }
 return <div className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-40">
  {open&&<section aria-label="Razgovor sa Svetom Povoljnih Cena" className="mb-3 flex max-h-[calc(100dvh-6rem)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-soft-5">
   <div className="flex items-center justify-between border-b p-4"><div><p className="font-semibold">Svet Povoljnih Cena</p><p className="text-xs text-ink-500">Korisnička podrška · chat na sajtu</p></div><button onClick={()=>setOpen(false)} aria-label="Zatvori chat"><X className="size-5"/></button></div>
   <div aria-live="polite" role="log" className="min-h-40 flex-1 space-y-3 overflow-y-auto p-4 text-sm" style={{maxHeight:400}}>
    {!messages.length&&<p>Dobro došli! Šta Vas zanima? Ovde možete pitati za proizvode i napraviti porudžbinu.</p>}
    {messages.map(m=><div key={m.id} className={`whitespace-pre-wrap break-words rounded-xl p-3 ${m.role==='user'?'ml-8 bg-[#0866ff] text-white':'mr-8 bg-gray-100 text-ink-900'}`}>
     {m.text.split(/(https:\/\/[^\s]+)/g).map((part,i)=>part.startsWith('https://')?<a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline">{part}</a>:part)}
     {m.imageUrl?.startsWith('https://')&&<img src={m.imageUrl} alt="Proizvod" className="mt-2 max-h-48 rounded object-contain"/>}
    </div>)}
    {waiting&&!support&&<p className="text-xs text-ink-500">Pripremamo odgovor…</p>}
    {support&&<p>Korisnička podrška će proveriti razgovor. Možete ostaviti dodatne informacije.</p>}
    <div ref={bottom}/>
   </div>
   {error&&<p role="alert" className="px-4 pb-2 text-xs text-red-700">{error}</p>}
   <form onSubmit={send} className="flex gap-2 border-t p-3"><input aria-label="Vaša poruka" placeholder="Napišite poruku…" maxLength={2000} value={text} onChange={e=>setText(e.target.value)} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-base"/><button type="submit" disabled={!ready||sending||!text.trim()} aria-label="Pošalji poruku" className="rounded-lg bg-[#0866ff] px-3 text-white disabled:opacity-50"><Send className="size-5"/></button></form>
  </section>}
  <button aria-label="Otvorite chat" aria-expanded={open} onClick={()=>setOpen(!open)} className="ml-auto flex size-12 items-center justify-center rounded-full bg-[#0866ff] text-white shadow-soft-4">{open?<X className="size-6"/>:<MessageCircle className="size-6"/>}</button>
 </div>;
}
