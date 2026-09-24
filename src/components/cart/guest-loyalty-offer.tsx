"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Mail, Gift } from "lucide-react";
import { useCart } from "@/lib/hooks/use-cart";
import { formatRsd } from "@/lib/format";
import { LOYALTY_CONSENT_SECTIONS, LOYALTY_CONSENT_VERSION, loyaltySavings } from "@/lib/loyalty/shared";
import { refreshGuestLoyalty, useGuestLoyalty } from "@/lib/loyalty/use-guest-loyalty";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

export function GuestLoyaltyOffer() {
  const lines = useCart((state) => state.lines);
  const member = useGuestLoyalty();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
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

  return <section className="border-action/25 bg-action/5 rounded-2xl border p-4 sm:p-5" aria-label="Loyalty pogodnosti">
    {member.email ? <>
      <p className="flex items-center gap-2 font-semibold text-ink-900"><CheckCircle2 className="size-5 text-action" aria-hidden />Loyalty pogodnosti su aktivne</p>
      <p className="mt-2 break-all text-sm text-ink-700">Potvrđen mejl: {member.email}</p>
      <p className="mt-1 text-sm text-ink-700">Loyalty cena važi za artikle bez aktivne akcije.{member.firstPurchase ? " Ostvarujete i dodatnih 15% za prvu kupovinu." : ""}</p>
      <button type="button" disabled={busy} onClick={changeEmail} className="mt-2 text-sm underline">Koristi drugi mejl</button>
    </> : <>
      <p className="flex items-center gap-2 font-semibold text-ink-900"><Gift className="size-5 text-action" aria-hidden />{savings > 0 ? `Uz loyalty biste uštedeli još ${formatRsd(savings)}` : "Ostvarite loyalty pogodnosti"}</p>
      <p className="mt-2 text-sm text-ink-700">30% loyalty popusta na artikle koji nisu na akciji i dodatnih 15% za prvu kupovinu. Potvrdite mejl — bez naloga i fizičke kartice.</p>
      <button type="button" onClick={() => setOpen(true)} className="mt-3 rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-canvas">Želim loyalty karticu</button>
      <p className="mt-2 text-xs text-ink-500">Popusti se aktiviraju nakon potvrde mejla. Prva kupovina se proverava prema istoriji porudžbina.</p>
    </>}
    {error && !open ? <p role="alert" className="mt-2 text-sm text-action">{error}</p> : null}
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="w-full! overflow-y-auto sm:max-w-lg!">
        <SheetHeader className="px-6 pt-8 pr-12">
          <SheetTitle className="text-2xl">Više uštede uz vaš mejl</SheetTitle>
          <SheetDescription>Pristupite SPC loyalty programu bez registracije.</SheetDescription>
        </SheetHeader>
        <div className="px-6 pb-8">
          {member.email ? <p role="status">Mejl je potvrđen. Loyalty pogodnosti su aktivne u korpi.</p> : <form onSubmit={request} className="space-y-5">
            <div className="rounded-xl bg-action/5 p-4 text-sm leading-relaxed text-ink-700">
              <p className="mb-2 font-semibold text-ink-900">Saglasnost za pristupanje</p>
              {LOYALTY_CONSENT_SECTIONS.map(({ title, body }) => <section key={title} className="mt-4"><h3 className="mb-1 font-semibold text-ink-900">{title}</h3><p>{body}</p></section>)}
              <Link href="/politika-privatnosti" target="_blank" className="mt-2 inline-block underline">Politika privatnosti</Link>
            </div>
            <div><label htmlFor={`${id}-email`} className="mb-2 block font-medium">Vaša mejl adresa</label>
              <input id={`${id}-email`} type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => { setEmail(e.target.value); setSent(false); }} className="w-full rounded-xl border border-border bg-canvas px-4 py-3" placeholder="ime@primer.rs" /></div>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-4 shrink-0" /><span>Želim da pristupim loyalty programu i saglasan/a sam sa navedenom obradom podataka.</span></label>
            {sent ? <p role="status" className="rounded-xl bg-muted-bg p-4 text-sm"><Mail className="mb-2 size-5" aria-hidden />Poslali smo link na <strong>{email}</strong>. Otvorite ga u ovom pregledaču da potvrdite mejl i aktivirate popuste u ovoj korpi. Link važi 30 minuta.</p> : null}
            {error ? <p role="alert" className="text-sm text-action">{error}</p> : null}
            <button type="submit" disabled={busy || !consent} className="w-full rounded-full bg-ink-900 px-5 py-3 font-semibold text-canvas disabled:opacity-50">{busy ? "Šaljem…" : sent ? "Pošalji link ponovo" : "Pošalji link za potvrdu"}</button>
          </form>}
        </div>
      </SheetContent>
    </Sheet>
  </section>;
}
