/* eslint-disable @next/next/no-img-element -- Operator preview of uploaded/pasted remote images. */
"use client";
import Link from "next/link";
import { smsSegments } from "@/lib/messaging/sms";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ArrowLeft, ArrowRight, Check, ImagePlus, Send, Copy, Search, RefreshCw, Users, MessageCircle, CheckCheck, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatBelgradePricingDateTime } from "@/lib/admin/pricing-date-time";
import { campaignStatusLabel, messageStatusLabel, audienceDescription } from "@/lib/viber/ui";
import { EMPTY_ADMIN_ACTION_STATE, type AdminActionState } from "@/lib/admin/action-state";

export type ViberCampaignView = { id: string; title: string; body: string; audienceId: string; audienceName: string; imageUrl: string | null; ctaLabel: string | null; ctaUrl: string | null; status: string; scheduledAt: string | null; recipients: number | null; accepted: number | null; failed: number | null };
export type ViberDashboardProps = {
  channel?: "VIBER" | "SMS";
  aiReady?: boolean;
  suggestEdit?: (form: FormData) => Promise<{ ok: boolean; text?: string; error?: string }>;
  contactSummary?: { total: number; eligible: number; allEligible?: number; withoutConsent: number; invalid: number };
  audiences: { id: string; name: string; description: string }[];
  campaigns: ViberCampaignView[];
  reports: { id: string; status: string; time: string; recipient: string; description: string }[];
  metrics: { queued: number; accepted: number; delivered: number; seen: number; failed: number; unknown: number };
  ready: boolean; scheduledEnabled: boolean; ordersEnabled: boolean;
  confirmationConfigured: boolean; statusConfigured: boolean;
  initialCampaign?: ViberCampaignView | null;
  previewAudience: (form: FormData) => Promise<{ ok: boolean; count?: number; error?: string }>;
  saveDraft: (state: AdminActionState, form: FormData) => Promise<AdminActionState>;
  launch: (state: AdminActionState, form: FormData) => Promise<AdminActionState>;
  testMessage: (state: AdminActionState, form: FormData) => Promise<AdminActionState>;
  deleteDraft: (state: AdminActionState, form: FormData) => Promise<AdminActionState>;
};
const box = "rounded-xl border border-border bg-card p-5";
const fmt = (date: string) => new Intl.DateTimeFormat("sr-Latn-RS", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Belgrade" }).format(new Date(date));

export function ViberDashboard(p: ViberDashboardProps) {
  const router = useRouter();
  const channel = p.channel ?? "VIBER";
  const sms = channel === "SMS";
  const label = sms ? "SMS" : "Viber";
  const [aiInstruction, setAiInstruction] = useState("Učini poruku jasnijom i kraćom.");
  const [aiText, setAiText] = useState("");
  const aiVersion = useRef(0);
  const [tab, setTab] = useState("campaigns");
  const [editing, setEditing] = useState(Boolean(p.initialCampaign));
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(p.initialCampaign ?? null);
  const [title, setTitle] = useState(p.initialCampaign?.title ?? "");
  const [body, setBody] = useState(p.initialCampaign?.body ?? "");
  const [imageUrl, setImage] = useState(p.initialCampaign?.imageUrl ?? "");
  const [ctaLabel, setLabel] = useState(p.initialCampaign?.ctaLabel ?? "");
  const [ctaUrl, setUrl] = useState(p.initialCampaign?.ctaUrl ?? "");
  const [audienceId, setAudience] = useState(p.initialCampaign?.audienceId ?? "");
  const [allStoredPhones, setAllStoredPhones] = useState(!p.initialCampaign);
  const [everyone, setEveryone] = useState(true);
  const [cities, setCities] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [mode, setMode] = useState(p.scheduledEnabled && p.initialCampaign?.status === "SCHEDULED" ? "scheduled" : "draft"); const [scheduledAt, setScheduledAt] = useState(formatBelgradePricingDateTime(p.initialCampaign?.scheduledAt ? new Date(p.initialCampaign.scheduledAt) : null));
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(""); const [error, setError] = useState(false);
  const [testFeedback, setTestFeedback] = useState("");
  const [testOk, setTestOk] = useState(false);
  const [phone, setPhone] = useState(""); const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState(""); const [statusFilter, setStatusFilter] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const countRequest = useRef(0);
  const changed = () => { setSaved(false); setMessage(""); setAiText(""); setTestFeedback(""); aiVersion.current++; };
  const audienceChanged = () => { changed(); setCount(null); countRequest.current++; };
  function form() {
    const f = new FormData();
    for (const [key, value] of Object.entries({ channel, id: draft?.id ?? "", title, body, imageUrl, ctaLabel, ctaUrl, audienceId, allStoredPhones: String(allStoredPhones), everyone: String(everyone), cities, from, to, mode, scheduledAt })) f.set(key, value);
    return f;
  }
  function newCampaign(c?: ViberCampaignView, clone = false) {
    aiVersion.current++; setAiText(""); setTestFeedback("");
    setDraft(c && !clone ? c : null); setTitle(c ? c.title + (clone ? " · kopija" : "") : ""); setBody(c?.body ?? "");
    setImage(c?.imageUrl ?? ""); setLabel(c?.ctaLabel ?? ""); setUrl(c?.ctaUrl ?? ""); setAudience(c?.audienceId ?? "");
    setAllStoredPhones(!c); setCities(""); setFrom(""); setTo(""); setEveryone(true); setMode(!clone && p.scheduledEnabled && c?.status === "SCHEDULED" ? "scheduled" : "draft"); setScheduledAt(!clone && c?.scheduledAt ? formatBelgradePricingDateTime(new Date(c.scheduledAt)) : ""); setCount(null); setSaved(false);setMessage("");setStep(0);setEditing(true);setTab("campaigns");
  }
  const previewAudience = p.previewAudience;
  useEffect(() => {
    if (!editing) return;
    const request = ++countRequest.current;
    let active = true;
    const timer = setTimeout(() => {
      const f = new FormData();
      for (const [key, value] of Object.entries({ channel, audienceId, allStoredPhones: String(allStoredPhones), everyone: String(everyone), cities, from, to })) f.set(key, value);
      void previewAudience(f).then(result => { if (active && request === countRequest.current) { setCount(result.ok ? result.count ?? 0 : null); if (!result.ok) { setError(true); setMessage(result.error ?? "Provera publike nije uspela."); } } }).catch(() => { if (active && request === countRequest.current) { setError(true); setMessage("Broj primalaca trenutno nije dostupan. Kliknite Proveri publiku."); } });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [editing, channel, audienceId, allStoredPhones, everyone, cities, from, to, previewAudience]);
  async function suggest() {
    if (!p.suggestEdit || !body.trim()) return;
    const version = ++aiVersion.current;
    setBusy(true); setMessage(""); setAiText("");
    const f = new FormData(); f.set("channel", channel); f.set("body", body); f.set("instruction", aiInstruction);
    try { const r = await p.suggestEdit(f); if (version !== aiVersion.current) return; if (!r.ok || !r.text) throw new Error(r.error ?? "AI nije vratio predlog."); setAiText(r.text); }
    catch (e) { if (version === aiVersion.current) { setError(true); setMessage(e instanceof Error ? e.message : "AI predlog nije uspeo."); } }
    finally { setBusy(false); }
  }
  async function checkAudience() {
    const requestId = ++countRequest.current;
    setBusy(true); setMessage("");
    try { const result = await p.previewAudience(form()); if (requestId !== countRequest.current) return; if (!result.ok) throw new Error(result.error); setCount(result.count ?? 0); }
    catch (e) { setError(true);setMessage(e instanceof Error ? e.message : "Provera publike nije uspela."); }
    finally { setBusy(false); }
  }
  async function action(fn: ViberDashboardProps["saveDraft"], f: FormData) {
    setBusy(true);setMessage("");
    try { const result = await fn(EMPTY_ADMIN_ACTION_STATE, f); setError(!result.ok);setMessage(result.message);if(result.ok) router.refresh();return result; }
    catch { setError(true);setMessage("Akcija nije potvrđena. Proverite rezultate pre ponavljanja slanja.");return null; }
    finally { setBusy(false); }
  }
  async function save() {
    const r = await action(p.saveDraft, form());
    if (r?.ok && r.result) { const result = r.result as { id: string; audienceId: string }; setDraft({ id: result.id } as ViberCampaignView);setAudience(result.audienceId);setSaved(true); }
  }
  async function upload(file?: File) {
    if (!file || uploading) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 4*1024*1024) { setError(true);setMessage("Izaberite JPG, PNG ili WebP sliku do 4 MB.");return; }
    setUploading(true);setMessage("");
    try { const data = new FormData();data.set("file", file);const r = await fetch("/api/admin/viber-media",{method:"POST",body:data}); const result=await r.json().catch(()=>null);if(!r.ok||!result?.url)throw new Error(result?.error??"Dodavanje slike nije uspelo. Pokušajte ponovo.");setImage(result.url);changed(); }
    catch(e){setError(true);setMessage(e instanceof Error?e.message:"Slika nije dodata.");}finally{setUploading(false);if(fileInput.current)fileInput.current.value="";}
  }
  const filtered = p.campaigns.filter(c => c.title.toLowerCase().includes(search.toLowerCase()) && (!statusFilter || c.status===statusFilter));
  const audienceSummary = audienceId ? p.audiences.find(a=>a.id===audienceId)?.description ?? "Sačuvana publika" : audienceDescription({allStoredPhones,phoneScope:"current",channel,includeNonCustomers:everyone&&!cities&&!from&&!to,cities:cities.split(',').filter(Boolean),lastPurchaseFrom:from,lastPurchaseTo:to});
  const smsInfo = smsSegments(body);
  const validContent = body.trim() && (sms || body.length <= 1000) && (!imageUrl || (ctaLabel.trim() && ctaUrl)) && Boolean(ctaLabel) === Boolean(ctaUrl);
  const validMessage = title.trim() && validContent;
  const testPanel = <div className="rounded-lg border border-border bg-muted-bg/50 p-4 space-y-3"><h3 className="font-medium">Pošalji na jedan broj — test</h3><p className="text-sm text-ink-500">Unesite svoj ili drugi probni broj. Šalje se trenutni tekst poruke samo na taj broj. Nije potrebno čuvanje nacrta.</p><div className="flex flex-wrap gap-2"><Input className="min-w-0 flex-1" value={phone} type="tel" aria-label="Broj za test poruku" placeholder="063… ili +381…" onChange={e=>{setPhone(e.target.value);setTestFeedback("");}}/><Button variant="outline" disabled={!validContent||uploading||!p.ready||busy||!phone.trim()} onClick={()=>{const f=form();f.set('phone',phone);void action(p.testMessage,f).then(r=>{setTestOk(Boolean(r?.ok));setTestFeedback(r?.message??"Ishod nije potvrđen. Proverite rezultate pre ponavljanja.");});}}>Pošalji test</Button></div>{testFeedback&&<p role={testOk?'status':'alert'} className={`text-sm ${testOk?'text-success':'text-destructive'}`}>{testFeedback}</p>}<p className="text-xs text-ink-500">Test ne pokreće kampanju. Prihvaćena poruka čeka potvrdu isporuke u rezultatima.</p><button type="button" className="text-sm text-walnut underline" onClick={()=>setTab('results')}>Otvori rezultate isporuke</button></div>;
  return <div className="space-y-6 px-4 py-6 sm:px-8">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">{label} poruke</h1><p className="mt-1 text-sm text-ink-500">{sms ? "SMS kampanje, test poruke i rezultati na jednom mestu." : "Kampanje, obaveštenja o porudžbinama i rezultati na jednom mestu."}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>router.refresh()} aria-label="Osveži podatke"><RefreshCw /></Button><Button variant="outline" onClick={()=>{if(editing&&!saved&&(title||body)&&!window.confirm("Otvoriti novu test poruku? Nesačuvane izmene će biti izgubljene."))return;newCampaign();setStep(1);}}>Test na jedan broj</Button><Button onClick={()=>newCampaign()}><Plus />Nova kampanja</Button></div></div>
    <nav aria-label="Kanali poruka" className="flex gap-2">{[["VIBER", "Viber"], ["SMS", "SMS"]].map(([id, name]) => <Link key={id} href={id === "SMS" ? "/admin/viber?channel=sms" : "/admin/viber"} onClick={e => {if (channel !== id && editing && !saved && (title || body) && !window.confirm("Promeniti kanal? Nesačuvane izmene će biti izgubljene.")) e.preventDefault();}} aria-current={channel === id ? "page" : undefined} className={`rounded-lg border px-5 py-2 text-sm font-medium ${channel === id ? "border-walnut bg-walnut text-white" : "border-border"}`}>{name}</Link>)}</nav>
    <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${p.ready?'bg-success/10 text-success':'bg-amber-500/10 text-amber-700'}`}><Check className="size-4"/>{p.ready?`${label} slanje je povezano. Evidentirane odjave se izuzimaju.`:"Slanje još nije omogućeno. Možete pripremati i čuvati nacrte."}</div>
    <nav aria-label={`${label} sekcije`} className="flex gap-1 overflow-x-auto border-b border-border">{[['campaigns','Kampanje'],...(!sms ? [['automatic','Automatske poruke']] : []),['results','Rezultati']].map(([id,label])=><button key={id} type="button" aria-current={tab===id?'page':undefined} onClick={()=>{setTab(id);setMessage("");}} className={`shrink-0 border-b-2 px-4 py-3 text-sm ${tab===id?'border-walnut font-medium text-walnut':'border-transparent text-ink-500'}`}>{label}</button>)}</nav>
    {message&&<p role={error?'alert':'status'} className={`rounded-lg p-3 text-sm ${error?'bg-destructive/10 text-destructive':'bg-success/10 text-success'}`}>{message}</p>}
    {tab==='campaigns' && (editing ? <>
      <div className="flex items-center justify-between gap-2"><Button variant="ghost" onClick={()=>{if(!saved&&(title||body)&&!window.confirm('Izaći iz pripreme? Nesačuvane izmene će biti izgubljene.'))return;setEditing(false);}}><ArrowLeft/>Sve kampanje</Button><span className="text-xs text-ink-500">{saved?'Nacrt sačuvan':'Priprema kampanje · ništa nije poslato'}</span></div>
      <ol className="grid grid-cols-3 gap-2">{['Publika','Poruka','Pregled i slanje'].map((label,i)=><li key={label} className={`rounded-lg border px-3 py-3 text-sm ${i===step?'border-walnut bg-walnut/5':'border-border text-ink-500'}`}><span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-muted-bg text-xs">{i+1}</span>{label}</li>)}</ol>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className={box} aria-label="Priprema kampanje">
          {step===0?<div className="space-y-5"><div><h2 className="text-lg font-medium">Kome šaljemo poruku?</h2><p className="mt-1 text-sm text-ink-500">Podrazumevano su izabrani svi kupci i kontakti sa važećim brojem. Duplikati i evidentirane odjave se izuzimaju.</p></div>
            {p.contactSummary&&<div className="rounded-lg border border-border p-4 text-sm"><h3 className="font-medium">Svi brojevi telefona iz baze</h3><p className="mt-2">Ukupno jedinstvenih brojeva: <strong>{p.contactSummary.total.toLocaleString('sr-RS')}</strong></p><p>Svi postojeći brojevi za slanje: <strong>{(p.contactSummary.allEligible??p.contactSummary.eligible).toLocaleString('sr-RS')}</strong></p><p className="mt-2 text-xs text-ink-500">Brojevi se računaju iz naloga, kupaca i porudžbina. Duplikati se spajaju. Nalozi kupaca nisu obavezni. Brojeva sa posebno evidentiranom {label} saglasnošću na sajtu: {p.contactSummary.eligible.toLocaleString('sr-RS')}. To je uži, opcioni izbor. Evidentirane odjave se izuzimaju; {p.contactSummary.invalid.toLocaleString('sr-RS')} zapisa nema ispravan format za Srbiju.</p><Button className="mt-3" variant="outline" onClick={()=>{setAudience('');setAllStoredPhones(true);setEveryone(true);setCities('');setFrom('');setTo('');audienceChanged();}}>Izaberi sve brojeve telefona</Button></div>}
            <label className="block space-y-2 text-sm">Sačuvana publika<select className="h-10 w-full rounded-lg border border-input bg-background px-3" value={audienceId} onChange={e=>{setAudience(e.target.value);setAllStoredPhones(false);audienceChanged();}}><option value="">Novi izbor publike</option>{p.audiences.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
            {!audienceId&&<>{allStoredPhones&&<p className="rounded-lg bg-success/10 p-3 text-sm">Izabrani su svi važeći brojevi, uključujući kupce bez naloga i nove kontakte.</p>}<fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Osnovna publika</legend>{[[null,'Svi kupci i kontakti sa brojem telefona'],[true,`Samo kontakti sa ${label} saglasnošću unetom na sajtu`],[false,`Završene kupovine sa ${label} saglasnošću na sajtu`]].map(([v,label])=><label key={String(v)} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm"><input type="radio" name="audience-base" checked={v === null ? allStoredPhones : !allStoredPhones&&everyone===v} onChange={()=>{setAllStoredPhones(v === null);setEveryone(v === null ? true : v as boolean);audienceChanged();}}/>{label as string}</label>)}</fieldset>{!allStoredPhones&&<details><summary className="cursor-pointer text-sm text-walnut">Suzi publiku po gradu ili datumu kupovine</summary><div className="mt-4 space-y-3"><p className="text-xs text-ink-500">Ovi uslovi biraju kupce sa završenom kupovinom.</p><label className="block space-y-1 text-sm">Gradovi<Input value={cities} placeholder="Npr. Beograd, Novi Sad" onChange={e=>{setCities(e.target.value);audienceChanged();}}/></label><div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-sm">Kupovina od<Input type="date" value={from} onChange={e=>{setFrom(e.target.value);audienceChanged();}}/></label><label className="space-y-1 text-sm">Kupovina do<Input type="date" value={to} onChange={e=>{setTo(e.target.value);audienceChanged();}}/></label></div></div></details>}</>}
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted-bg p-4"><Users className="size-5"/><div className="flex-1"><p className="font-medium">{count===null?'Broj primalaca još nije proveren':`${count.toLocaleString('sr-RS')} primalaca`}</p><p className="text-xs text-ink-500">Broj se može promeniti ako korisnik povuče saglasnost.</p></div><Button variant="outline" disabled={busy} onClick={()=>void checkAudience()}>{busy?'Provera…':'Proveri publiku'}</Button></div>
          </div>:step===1?<div className="space-y-5"><h2 className="text-lg font-medium">Šta piše u poruci?</h2><label className="block space-y-2 text-sm">Naziv kampanje<Input value={title} maxLength={120} placeholder="Npr. Vikend ponuda — oktobar" onChange={e=>{setTitle(e.target.value);changed();}}/><span className="text-xs text-ink-500">Naziv je samo za vas. Primalac vidi tekst poruke.</span></label><label className="block space-y-2 text-sm">Tekst poruke<Textarea value={body} rows={6} maxLength={sms ? undefined : 1000} placeholder="Napišite ponudu i razlog da je korisnik pogleda…" onChange={e=>{setBody(e.target.value);changed();}}/></label><div className="flex justify-between text-xs text-ink-500">{!sms&&<button type="button" disabled={body.length > 994} className="text-walnut underline disabled:opacity-50" onClick={()=>{setBody(body+' {ime}');changed();}}>Ubaci ime primaoca</button>}<span>{body.length}{sms ? "" : "/1000"} znakova{sms ? ` · ${smsInfo.encoding} · ${smsInfo.parts} ${smsInfo.parts === 1 ? "SMS deo" : "SMS delova"}` : ""}</span></div>
            <div className="rounded-lg border border-border p-4 space-y-3"><h3 className="text-sm font-medium">Uredi uz AI</h3><label className="block space-y-2 text-sm">Šta da promenimo?<Input value={aiInstruction} maxLength={500} onChange={e => {setAiInstruction(e.target.value); setAiText(""); aiVersion.current++;}} placeholder="Npr. skrati, dodaj topliji ton, bez emoji…"/></label><Button variant="outline" disabled={busy || !body.trim() || !aiInstruction.trim() || !p.aiReady} onClick={() => void suggest()}>{busy ? "Priprema predloga…" : "Predloži izmenu"}</Button>{!p.aiReady&&<p className="text-xs text-ink-500">AI uređivanje čeka podešavanje SPC OpenAI ključa.</p>}{aiText&&<div className="space-y-3"><p className="whitespace-pre-wrap break-words rounded-lg bg-muted-bg p-3 text-sm">{aiText}</p><div className="flex flex-wrap gap-2"><Button onClick={()=>{setBody(aiText);changed();}}>Prihvati predlog</Button><Button variant="ghost" onClick={()=>setAiText("")}>Zadrži original</Button></div></div>}<p className="text-xs text-ink-500">AI dobija samo tekst i uputstvo za uređivanje. Predlog ništa ne šalje primaocima.</p></div>
            {sms ? <p className="rounded-lg bg-muted-bg p-3 text-sm">Pošiljalac: SvetPovCena. Link unesite u tekst. Slova č, ć, š, ž i đ koriste Unicode i mogu povećati broj SMS delova. Broj delova je procena po primaocu, bez cene provajdera.</p> : <>            <div className="space-y-3"><p className="text-sm font-medium">Slika (opciono)</p><input ref={fileInput} className="sr-only" type="file" aria-label="Dodaj sliku za Viber" accept="image/jpeg,image/png,image/webp" onChange={e=>void upload(e.target.files?.[0])}/><button type="button" disabled={uploading} onClick={()=>fileInput.current?.click()} className="flex w-full items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-5 text-sm"><ImagePlus/>{uploading?'Dodavanje slike…':'Izaberi sliku sa uređaja'}</button><p className="text-xs text-ink-500">JPG, PNG ili WebP · do 4 MB. Uz sliku dodajte dugme ispod.</p>{imageUrl&&<Button variant="ghost" onClick={()=>{setImage('');changed();}}>Ukloni sliku</Button>}<details><summary className="cursor-pointer text-xs text-ink-500">Ili koristi link postojeće slike</summary><Input aria-label="Link slike" className="mt-2" value={imageUrl} onChange={e=>{setImage(e.target.value);changed();}} placeholder="https://…"/></details></div>
            <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2 text-sm">Tekst dugmeta<Input value={ctaLabel} maxLength={30} placeholder="Pogledaj ponudu" onChange={e=>{setLabel(e.target.value);changed();}}/></label><label className="space-y-2 text-sm">Link na dugmetu<Input value={ctaUrl} placeholder="https://www.svetpovoljnihcena.rs/…" onChange={e=>{setUrl(e.target.value);changed();}}/></label></div></>}

          </div>:<div className="space-y-5"><h2 className="text-lg font-medium">Proverite pre slanja</h2><dl className="space-y-3 text-sm"><div><dt className="text-ink-500">Kampanja</dt><dd className="font-medium">{title}</dd></div><div><dt className="text-ink-500">Publika</dt><dd>{audienceSummary}</dd></div><div><dt className="text-ink-500">Primalaca</dt><dd className="text-xl font-medium">{count ?? 'Nije provereno'}</dd></div></dl><label className="block space-y-2 text-sm">Kada šaljemo?<select className="h-10 w-full rounded-lg border border-input bg-background px-3" value={mode} onChange={e=>{setMode(e.target.value);changed();}}><option value="draft">Ručno, kada kliknem „Pošalji kampanju“</option>{p.scheduledEnabled&&<option value="scheduled">Zakaži za kasnije</option>}</select></label>{mode==='scheduled'&&<label className="block space-y-2 text-sm">Datum i vreme<Input type="datetime-local" value={scheduledAt} onChange={e=>{setScheduledAt(e.target.value);changed();}}/><span className="text-xs text-ink-500">Vreme u Srbiji (Beograd).</span></label>}{!p.scheduledEnabled&&<p className="rounded-lg bg-muted-bg p-3 text-xs text-ink-500">Automatsko zakazivanje još nije aktivirano. Nacrt možete sačuvati i poslati ručno.</p>}
            <Button disabled={busy||uploading} onClick={()=>void save()}>{busy?'Čuvanje…':mode==='scheduled'?'Sačuvaj i zakaži':'Sačuvaj nacrt'}</Button>
            {testPanel}
            <div className="border-t border-border pt-5"><Button disabled={!saved||!p.ready||busy||!count||mode==='scheduled'} onClick={()=>{if(!window.confirm(`Poslati kampanju „${title}“ publici od približno ${count} primalaca?`))return;const f=new FormData();f.set('channel',channel);f.set('id',draft?.id??'');void action(p.launch,f).then(r=>{if(r?.ok)setEditing(false);});}}><Send/>Pošalji kampanju</Button><p className="mt-2 text-xs text-ink-500">Pre slanja ponovo se proveravaju izabrana publika i evidentirane odjave.</p></div>
          </div>}
          {step===1&&<div className="mt-6">{testPanel}</div>}
          <div className="mt-6 flex justify-between border-t border-border pt-4"><Button variant="outline" disabled={step===0||busy} onClick={()=>setStep(step-1)}><ArrowLeft/>Nazad</Button>{step<2&&<Button disabled={busy||uploading||(step===0&&count===null)||(step===1&&!validMessage)} onClick={()=>setStep(step+1)}>Dalje<ArrowRight/></Button>}</div>
        </section>
        <aside className="lg:sticky lg:top-6"><h2 className="mb-3 text-sm font-medium">Kako će poruka izgledati</h2><div className="overflow-hidden rounded-[26px] border-[6px] border-stone-800 bg-[#edeaf4]"><div className="flex items-center gap-3 bg-[#7360aa] px-4 py-4 text-white"><MessageCircle className="size-6"/><div className="text-sm font-medium">{sms ? "SvetPovCena" : "Svet povoljnih cena"}<p className="text-xs font-normal text-white/80">Poslovna poruka</p></div></div><div className="min-h-64 p-4"><div className="overflow-hidden rounded-xl bg-white text-stone-900 shadow-sm">{imageUrl&&<img src={imageUrl} alt="Slika iz kampanje" className="max-h-64 w-full object-contain"/>}<p className="whitespace-pre-wrap break-words p-4 text-sm">{body.replace(/\{ime\}/g,'Ana')||'Tekst poruke će se pojaviti ovde.'}</p>{ctaLabel&&<div className="mx-3 mb-3 rounded-lg bg-[#7360aa] px-3 py-3 text-center text-sm font-medium text-white">{ctaLabel}</div>}</div></div></div><p className="mt-3 text-xs text-ink-500">Ilustrativni pregled. Izgled se može malo razlikovati na telefonu primaoca.</p></aside>
      </div>
    </>:<section className={box}><div className="mb-5 flex flex-wrap gap-3"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-2.5 size-4 text-ink-500"/><Input className="pl-9" placeholder="Pronađi kampanju po nazivu" aria-label="Pretraga kampanja" value={search} onChange={e=>setSearch(e.target.value)}/></div><select className="h-8 rounded-lg border border-input bg-background px-3 text-sm" aria-label="Status kampanje" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">Svi statusi</option>{Object.entries(campaignStatusLabel).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>{!filtered.length?<div className="py-14 text-center"><MessageCircle className="mx-auto mb-3 size-9 text-ink-500"/><h2 className="font-medium">{p.campaigns.length?'Nema kampanja za izabrani filter':`Napravite prvu ${label} kampanju`}</h2><p className="mb-5 mt-2 text-sm text-ink-500">Izaberite publiku, napišite poruku i proverite je pre slanja.</p><Button onClick={()=>newCampaign()}>Nova kampanja</Button></div>:<div className="space-y-3">{filtered.map(c=><article key={c.id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border p-4"><div className="min-w-0"><h2 className="break-words font-medium">{c.title}</h2><p className="mt-1 text-xs text-ink-500">{c.audienceName} · {campaignStatusLabel[c.status]??c.status}{c.scheduledAt?` · ${fmt(c.scheduledAt)}`:''}</p><p className="mt-2 line-clamp-2 max-w-xl text-sm text-ink-500">{c.body}</p>{c.recipients!==null&&<p className="mt-2 text-xs">Predato za slanje: {c.accepted??0} / {c.recipients} · greške pri predaji: {c.failed??0}</p>}</div><div className="flex flex-wrap gap-2">{['DRAFT','SCHEDULED'].includes(c.status)&&<Button variant="outline" onClick={()=>newCampaign(c)}>Otvori nacrt</Button>}<Button variant="ghost" onClick={()=>newCampaign(c,true)}><Copy/>Napravi kopiju</Button>{c.status==='DRAFT'&&<Button variant="ghost" disabled={busy} onClick={()=>{if(!window.confirm(`Obrisati nacrt „${c.title}“?`))return;const f=new FormData();f.set('channel',channel);f.set('id',c.id);void action(p.deleteDraft,f);}}>Obriši nacrt</Button>}</div></article>)}</div>}</section>)}
    {tab==='automatic'&&<section className={box}><h2 className="text-lg font-medium">Obaveštenja o porudžbinama</h2><p className="mb-5 mt-2 text-sm text-ink-500">Ove poruke se šalju automatski kada se događaj desi. Ne pravite kampanju za svaku porudžbinu.</p><div className="grid gap-4 md:grid-cols-2">{[['Potvrda porudžbine','Kupac dobija potvrdu nakon uspešne porudžbine.',p.confirmationConfigured],['Status i isporuka','Kupac dobija obaveštenje o pripremi, isporuci ili promeni statusa.',p.statusConfigured]].map(([label,description,configured])=><div className="rounded-lg border border-border p-4" key={String(label)}><h3 className="font-medium">{label as string}</h3><p className="my-2 text-sm text-ink-500">{description as string}</p><span className="text-xs">{p.ordersEnabled&&configured?'Automatsko slanje uključeno':configured?'Šablon podešen · slanje nije uključeno':'Čeka odobrenje i aktivaciju šablona'}</span></div>)}</div><p className="mt-5 rounded-lg bg-muted-bg p-3 text-sm text-ink-500">Transakcijski šabloni su prijavljeni. Odobrenje obavlja NTH/Viber. Dok slanje nije uključeno, korisnici ne dobijaju ove Viber poruke.</p><a href="https://omni-manager.nth.ch/viber/message-templates" target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm text-walnut underline">Otvori šablone kod provajdera</a></section>}
    {tab==='results'&&<><div><h2 className="font-medium">Poruke u poslednjih 30 dana</h2><p className="mt-1 text-xs text-ink-500">Podaci se osvežavaju dugmetom iznad. Vreme je prikazano za Srbiju.</p></div><div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{[[p.metrics.queued,'U redu'],[p.metrics.accepted,'Čekaju isporuku'],[p.metrics.delivered,'Isporučene'],...(!sms ? [[p.metrics.seen,'Pročitane']] : []),[p.metrics.failed,'Neuspešne'],[p.metrics.unknown,'Potrebna provera']].map(([v,label])=><div key={String(label)} className="rounded-lg border border-border bg-card p-4"><p className="text-2xl font-medium">{v}</p><p className="mt-1 text-xs text-ink-500">{label}</p></div>)}</div><section className={box}><h3 className="mb-4 font-medium">Poslednjih 50 poruka</h3>{!p.reports.length?<p className="py-8 text-center text-sm text-ink-500">Još nema poruka poslatih iz ovog panela.</p>:<div className="overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead><tr className="border-b border-border text-xs text-ink-500"><th className="pb-3">Vreme</th><th>Primalac</th><th>Poruka</th><th>Status</th></tr></thead><tbody>{p.reports.map(r=><tr className="border-b border-border last:border-0" key={r.id}><td className="py-3 pr-4">{fmt(r.time)}</td><td className="pr-4">{r.recipient}</td><td className="max-w-64 pr-4"><span className="line-clamp-2">{r.description}</span></td><td><span className="flex items-center gap-1.5">{['VIBER_DELIVERED','VIBER_SEEN'].includes(r.status)?<CheckCheck className="size-4 text-success"/>:r.status==='VIBER_UNKNOWN'?<AlertCircle className="size-4 text-amber-600"/>:null}{messageStatusLabel[r.status]??'Nepoznat status'}</span></td></tr>)}</tbody></table></div>}<p className="mt-4 text-xs text-ink-500">Prihvaćena poruka još nije potvrđeno isporučena. „Potrebna provera“ znači da rezultat nije pouzdano potvrđen; ne ponavljajte slanje dok ne proverite izveštaj.</p><a href="https://reporting.nth.ch/dashboards" target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-walnut underline">Detaljan izveštaj kod provajdera</a></section></>}
  </div>;
}
