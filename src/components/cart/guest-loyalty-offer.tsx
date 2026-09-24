"use client";
import { useId, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Gift } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLoyaltyEligibility } from "@/components/pricing/pricing-eligibility";
import { useCart } from "@/lib/hooks/use-cart";
import { formatRsd } from "@/lib/format";
import { LOYALTY_CONSENT_SECTIONS, LOYALTY_CONSENT_VERSION, loyaltySavings, appliedLoyaltySavings } from "@/lib/loyalty/shared";
import { activateGuestLoyalty, refreshGuestLoyalty, useGuestLoyalty } from "@/lib/loyalty/use-guest-loyalty";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

export function GuestLoyaltyOffer() {
  const lines = useCart((state) => state.lines);
  const member = useGuestLoyalty();
  const [open, setOpen] = useState(false);
  const loggedIn = useLoyaltyEligibility();
  const { status, data: session } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const panelHeader = useRef<HTMLDivElement>(null);
  const savings = loyaltySavings(lines);
  const appliedSavings = appliedLoyaltySavings(lines);

  async function request() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/loyalty/request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, consentVersion: LOYALTY_CONSENT_VERSION }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "Aktivacija nije uspela. Pokušajte ponovo.");
      // The server has saved consent; apply the known offer immediately.
      activateGuestLoyalty();
      const cart = useCart.getState();
      cart.reprice(cart.lines.map((line) => ({ ...line,
        unitPriceSale: Math.min(line.unitPriceSale, line.unitPriceLoyalty ?? line.unitPriceSale),
      })));
      setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Aktivacija nije uspela."); }
    finally { setBusy(false); }
  }

  async function removeBenefits() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/loyalty/status", { method: "DELETE" });
      if (!response.ok) throw new Error();
      await refreshGuestLoyalty();
    } catch { setError("Uklanjanje pogodnosti nije uspelo. Pokušajte ponovo."); }
    finally { setBusy(false); }
  }

  if (loggedIn || status === "loading" || (status === "authenticated" && session?.user?.userType === "customer") || !lines.length) return null;

  return <section className="rounded-xl border border-action/20 bg-action/[0.03] p-4" aria-label="Loyalty pogodnosti" aria-busy={busy}>
    <p className="flex items-center gap-2 text-sm font-semibold text-action"><Gift className="size-5 shrink-0" aria-hidden />{member.active ? (appliedSavings > 0 ? "Loyalty popust je primenjen" : "Loyalty pogodnosti su aktivne") : "Ostvarite loyalty popust"}</p>
    <p className="mt-1.5 text-sm text-ink-700" aria-live="polite">{member.active ? (appliedSavings > 0 ? <>Uštedeli ste <strong className="text-action">{formatRsd(appliedSavings)}</strong> na ovoj korpi.</> : "Pogodnosti su aktivne za vašu kupovinu.") : (savings > 0 ? <>Uštedite odmah <strong className="text-action">{formatRsd(savings)}</strong> na ovoj korpi.</> : "30% popusta na artikle van akcije.")}</p>
    <label htmlFor={id} className="mt-3 flex cursor-pointer items-start gap-3 text-sm font-medium leading-5 text-ink-900">
      <input id={id} type="checkbox" checked={member.active} disabled={busy || !member.ready} onChange={(event) => { if (event.target.checked) void request(); else void removeBenefits(); }} aria-describedby={`${id}-consent`} className="mt-0.5 size-5 shrink-0 accent-ink-900 disabled:cursor-wait" />
      <span>{busy ? "Obračunavam pogodnosti…" : "Želim da pristupim loyalty programu"}</span>
    </label>
    <p id={`${id}-consent`} className="mt-2 text-xs leading-5 text-ink-500">Označavanjem prihvatate <button type="button" onClick={() => setOpen(true)} className="font-medium text-ink-700 underline underline-offset-2">izjavu o saglasnosti</button>. Bez naloga i kartice. Dodatnih 15% za prvu kupovinu proveravamo po unosu mejla pri poručivanju.</p>
    {error && <p role="alert" className="mt-2 text-sm text-action">{error}</p>}
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent initialFocus={panelHeader} className="w-full! max-w-full! gap-0! overflow-hidden bg-white! sm:max-w-[560px]!">
        <SheetHeader ref={panelHeader} tabIndex={-1} className="shrink-0 border-b border-border/60 px-6 py-6 pr-12 outline-none sm:px-8 sm:pr-14">
          <SheetTitle className="text-xl font-semibold text-ink-900!">Pridružite se loyalty programu</SheetTitle>
          <SheetDescription>Jedna saglasnost. Popust odmah u korpi.</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 sm:px-8">
              <div className="overflow-hidden rounded-2xl bg-ink-900 text-white">
                <Image src="/images/loyalty/spc-loyalty-email.png" alt="SPC loyalty pogodnosti za povoljniju kupovinu" width={1536} height={1024} sizes="(max-width: 560px) 100vw, 496px" className="aspect-[2/1] w-full object-cover" />
                <div className="px-5 py-5 sm:px-6">
                <p className="relative text-xs font-semibold tracking-[0.2em] text-white/70">SVET POVOLJNIH CENA</p>
                <h3 className="relative mt-3 text-2xl font-semibold leading-tight">Više razloga za dobru kupovinu.</h3>
                <div className="relative mt-6 flex gap-6 border-t border-white/20 pt-5"><div><p className="text-3xl font-bold">−30%</p><p className="mt-1 text-xs text-white/75">na artikle van akcije</p></div><div className="border-l border-white/20 pl-6"><p className="text-3xl font-bold">−15%</p><p className="mt-1 text-xs text-white/75">dodatno za prvu kupovinu</p></div></div>
                </div>
              </div>
              <p className="mt-5 text-sm leading-6 text-ink-700">Pročitajte izjavu i prihvatite pristupanje programu. Popust odmah obračunavamo u ovoj korpi. Mejl ćete uneti kasnije, uz podatke za porudžbinu.</p>
            <div className="mt-6 border-t border-border/60 pt-6 text-sm leading-6 text-ink-700">
              <p className="mb-5 text-xl font-semibold text-ink-900">Izjava o saglasnosti</p>
              {LOYALTY_CONSENT_SECTIONS.map(({ title, body }) => <section key={title} className="mt-4"><h3 className="mb-1 font-semibold text-ink-900">{title}</h3><p>{body}</p></section>)}
              <Link href="/politika-privatnosti" target="_blank" className="mt-2 inline-block underline">Politika privatnosti</Link>
            </div>
            </div>
            <div className="shrink-0 border-t border-border bg-white px-6 py-4 sm:px-8">
              <button type="button" onClick={() => setOpen(false)} className="w-full rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white">Nazad na kupovinu</button>
            </div>
        </div>
      </SheetContent>
    </Sheet>
  </section>;
}
