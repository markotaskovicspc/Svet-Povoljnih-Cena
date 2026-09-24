"use client";
import { useId, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Mail, Gift, ArrowRight, ChevronDown } from "lucide-react";
import { useCart } from "@/lib/hooks/use-cart";
import { formatRsd } from "@/lib/format";
import { LOYALTY_CONSENT_SECTIONS, LOYALTY_CONSENT_VERSION, loyaltySavings } from "@/lib/loyalty/shared";
import { refreshGuestLoyalty, useGuestLoyalty } from "@/lib/loyalty/use-guest-loyalty";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

export function GuestLoyaltyOffer() {
  const lines = useCart((state) => state.lines);
  const member = useGuestLoyalty();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const panelHeader = useRef<HTMLDivElement>(null);
  const savings = loyaltySavings(lines);

  async function request(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/loyalty/request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, consent, consentVersion: LOYALTY_CONSENT_VERSION }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "Slanje nije uspelo. Pokušajte ponovo.");
      setSent(true);
      await refreshGuestLoyalty();
    } catch (e) { setError(e instanceof Error ? e.message : "Slanje nije uspelo."); }
    finally { setBusy(false); }
  }

  async function changeEmail() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/loyalty/status", { method: "DELETE" });
      if (!response.ok) throw new Error();
      await refreshGuestLoyalty();
    } catch { setError("Promena mejla nije uspela. Pokušajte ponovo."); }
    finally { setBusy(false); }
  }

  return <section className="overflow-hidden rounded-xl border border-border bg-white p-5" aria-label="Loyalty pogodnosti">
    {member.email ? <>
      <p className="flex items-center gap-2 font-semibold text-ink-900"><CheckCircle2 className="size-5 text-action" aria-hidden />Loyalty pogodnosti su aktivne</p>
      <p className="mt-2 break-all text-sm text-ink-700">Potvrđen mejl: {member.email}</p>
      <p className="mt-1 text-sm text-ink-700">Loyalty cena važi za artikle bez aktivne akcije.{member.firstPurchase ? " Ostvarujete i dodatnih 15% za prvu kupovinu." : ""}</p>
      <button type="button" disabled={busy} onClick={changeEmail} className="mt-2 text-sm underline">Koristi drugi mejl</button>
    </> : <>
      <button type="button" aria-expanded={expanded} aria-controls={`${id}-offer`} onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-3 text-left font-semibold text-action focus-visible:outline-2 focus-visible:outline-action"><Gift className="size-5 shrink-0" aria-hidden /><span className="flex-1">Ostvarite loyalty popust</span><ChevronDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden /></button>
      {savings > 0 && <p className="mt-3 text-sm text-ink-700">Uštedite još <strong className="text-action">{formatRsd(savings)}</strong> na ovoj korpi.</p>}
      <div id={`${id}-offer`} hidden={!expanded} className="mt-4 border-t border-border/60 pt-4">
        <p className="text-sm leading-relaxed text-ink-700">Pridružite se uz potvrdu mejla i ostvarite <strong>30% na artikle van akcije</strong>, uz dodatnih <strong>15% za prvu kupovinu</strong>.</p>
        <p className="mt-2 text-xs text-ink-500">Bez kreiranja naloga. Bez fizičke kartice.</p>
        <button type="button" onClick={() => setOpen(true)} className="mt-4 flex w-full items-center justify-between gap-3 rounded-lg bg-muted-bg px-4 py-4 text-sm font-semibold text-ink-900 transition hover:bg-action/10"><span className="flex items-center gap-3"><Gift className="size-5 text-action" aria-hidden />Želim loyalty karticu</span><ArrowRight className="size-4" aria-hidden /></button>
        {member.pending && <p role="status" className="mt-3 text-xs leading-relaxed text-ink-500">Čekamo potvrdu mejla. Ova korpa prepoznaje potvrdu i iz drugog pregledača.</p>}
      </div>
    </>}
    {error && !open ? <p role="alert" className="mt-2 text-sm text-action">{error}</p> : null}
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent initialFocus={panelHeader} className="w-full! max-w-full! gap-0! overflow-hidden bg-white! sm:max-w-[560px]!">
        <SheetHeader ref={panelHeader} tabIndex={-1} className="shrink-0 border-b border-border/60 px-6 py-6 pr-12 outline-none sm:px-8 sm:pr-14">
          <SheetTitle className="text-xl font-semibold text-ink-900!">Pridružite se loyalty programu</SheetTitle>
          <SheetDescription>Vaš mejl. Vaše pogodnosti.</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          {member.email ? <div role="status" className="flex flex-1 flex-col items-center justify-center px-8 text-center"><CheckCircle2 className="mb-5 size-14 text-success" aria-hidden /><h3 className="text-2xl font-semibold">Dobro došli u SPC loyalty</h3><p className="mt-3 text-ink-500">Mejl je potvrđen. Pogodnosti su aktivne u vašoj korpi.</p><button type="button" onClick={() => setOpen(false)} className="mt-8 rounded-lg bg-ink-900 px-6 py-3 font-semibold text-white">Nastavi kupovinu</button></div> : <form onSubmit={request} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 sm:px-8">
              <div className="relative overflow-hidden rounded-2xl bg-ink-900 px-6 py-7 text-white">
                <Gift className="absolute -right-5 -bottom-6 size-40 -rotate-12 text-white/5" aria-hidden />
                <p className="relative text-xs font-semibold tracking-[0.2em] text-white/70">SVET POVOLJNIH CENA</p>
                <h3 className="relative mt-4 text-3xl font-semibold leading-tight">Više razloga<br />za dobru kupovinu.</h3>
                <div className="relative mt-6 flex gap-6 border-t border-white/20 pt-5"><div><p className="text-3xl font-bold">−30%</p><p className="mt-1 text-xs text-white/75">na artikle van akcije</p></div><div className="border-l border-white/20 pl-6"><p className="text-3xl font-bold">−15%</p><p className="mt-1 text-xs text-white/75">dodatno za prvu kupovinu</p></div></div>
              </div>
              <p className="mt-5 text-sm leading-6 text-ink-700">Dovoljan je vaš mejl. Pročitajte izjavu, prihvatite uslove pristupanja i potvrdite link koji vam pošaljemo.</p>
            <div className="mt-6 border-t border-border/60 pt-6 text-sm leading-6 text-ink-700">
              <p className="mb-5 text-xl font-semibold text-ink-900">Izjava o saglasnosti</p>
              {LOYALTY_CONSENT_SECTIONS.map(({ title, body }) => <section key={title} className="mt-4"><h3 className="mb-1 font-semibold text-ink-900">{title}</h3><p>{body}</p></section>)}
              <Link href="/politika-privatnosti" target="_blank" className="mt-2 inline-block underline">Politika privatnosti</Link>
            </div>
            </div>
            <div className="shrink-0 space-y-3 border-t border-border bg-white px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.04)] sm:px-8">
            <div><label htmlFor={`${id}-email`} className="mb-1.5 block text-sm font-medium">Vaša mejl adresa</label>
              <input id={`${id}-email`} type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => { setEmail(e.target.value); setSent(false); }} className="w-full rounded-lg border border-border bg-white px-4 py-3 text-base focus:outline-ink-900" placeholder="ime@primer.rs" /></div>
            <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-ink-700"><input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-ink-900" /><span>Želim da pristupim loyalty programu i saglasan/a sam sa navedenom obradom podataka.</span></label>
            {sent ? <p role="status" className="rounded-lg bg-muted-bg p-3 text-xs leading-5"><Mail className="mb-2 size-5" aria-hidden />Poslali smo link na <strong>{email}</strong>. Možete ga otvoriti u bilo kom pregledaču, pa se vratiti ovde. Ova korpa će automatski prepoznati potvrdu. Link važi 30 minuta.</p> : null}
            {error ? <p role="alert" className="text-sm text-action">{error}</p> : null}
            <button type="submit" disabled={busy || !consent} className="w-full rounded-lg bg-ink-900 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-walnut disabled:bg-muted-bg disabled:text-ink-500">{busy ? "Šaljem…" : sent ? "Pošalji link ponovo" : "Pošalji link za potvrdu"}</button>
            </div>
          </form>}
        </div>
      </SheetContent>
    </Sheet>
  </section>;
}
