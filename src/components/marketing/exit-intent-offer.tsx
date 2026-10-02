"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowRight, Check, Gift } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useCommerceTerms } from "@/components/pricing/commerce-terms-provider";
import { getConsentedAnalyticsContext, recordFirstPartyEvent } from "@/components/analytics/first-party-analytics";
import {
  EXIT_INTENT_CAMPAIGN, EXIT_INTENT_COOLDOWN_MS, EXIT_INTENT_RETAIN_MS, EXIT_INTENT_RETENTION_WINDOW_MS,
  exitIntentMetadataSchema, exitIntentPathAllowed, isTopExit,
  type ExitIntentEvent, type ExitIntentMetadata,
} from "@/lib/analytics/exit-intent";

const COOLDOWN_KEY = "spc_exit_offer_until";
const EXPOSURE_KEY = "spc_exit_offer_exposure";
type Exposure = { metadata: ExitIntentMetadata; anonymousId: string; at: number; retained: boolean };

function remember(exposure: Exposure) {
  try { window.sessionStorage.setItem(EXPOSURE_KEY, JSON.stringify(exposure)); } catch { /* Storage can be disabled. */ }
}

function restoreExposure(): Exposure | null {
  const context = getConsentedAnalyticsContext();
  if (!context) return null;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(EXPOSURE_KEY) || "null");
    const parsed = exitIntentMetadataSchema.safeParse(saved?.metadata);
    if (parsed.success && saved.anonymousId === context.anonymousId &&
      typeof saved.at === "number" && saved.at <= Date.now() &&
      Date.now() - saved.at < EXIT_INTENT_RETENTION_WINDOW_MS) {
      return { ...saved, metadata: parsed.data, retained: saved.retained === true };
    }
  } catch { /* No usable consented exposure. */ }
  return null;
}

export function ExitIntentOffer() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const { firstPurchasePct } = useCommerceTerms();
  const customer = session?.user?.userType === "customer";
  const [eligibleFor, setEligibleFor] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const openRef = useRef(false);
  const shown = useRef(false);
  const exposure = useRef<Exposure | null>(null);
  const identity = status === "unauthenticated" ? "guest" : customer ? session.user.id : null;
  const locationKey = `${identity}:${pathname}`;
  const open = openedFor === locationKey;
  const eligible = identity === "guest" || (identity !== null && eligibleFor === identity);
  // A route/account change invalidates the dialog instead of reopening it on Back.
  if (openedFor !== null && openedFor !== locationKey) setOpenedFor(null);

  useEffect(() => {
    if (!identity || identity === "guest") return;
    const abort = new AbortController();
    // The server checks purchase history. Failure suppresses the offer for signed-in customers.
    void fetch("/api/marketing/first-purchase-offer", { cache: "no-store", signal: abort.signal })
      .then(async response => response.ok ? response.json() : null)
      .then(result => { if (!abort.signal.aborted) setEligibleFor(result?.eligible ? identity : null); })
      .catch(() => {});
    return () => abort.abort();
  }, [identity]);

  function track(event: ExitIntentEvent) {
    const current = exposure.current;
    const context = getConsentedAnalyticsContext();
    if (!current || !context || context.anonymousId !== current.anonymousId) return false;
    return recordFirstPartyEvent({ type: "EXIT_INTENT", path: window.location.pathname, metadata: { ...current.metadata, event } });
  }

  function close(event: ExitIntentEvent = "dismissed") {
    if (openRef.current) track(event);
    openRef.current = false;
    setOpenedFor(null);
  }

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    exposure.current = restoreExposure();
    let activeMs = 0;
    let interacted = false;
    let measuredExposure = exposure.current?.metadata.exposureId;
    let previousTick = Date.now();
    function activity(event: Event) {
      if (event.isTrusted && exposure.current && !openRef.current && document.visibilityState === "visible" &&
        !(event.target instanceof Element && event.target.closest('[role="dialog"]'))) interacted = true;
    }
    function forgetWithoutConsent() {
      if (!getConsentedAnalyticsContext()) {
        exposure.current = null;
        try { window.sessionStorage.removeItem(EXPOSURE_KEY); } catch { /* No storage. */ }
      }
    }
    const interval = window.setInterval(() => {
      const now = Date.now();
      const elapsed = Math.min(now - previousTick, 1_500);
      previousTick = now;
      const current = exposure.current;
      if (current?.metadata.exposureId !== measuredExposure) {
        measuredExposure = current?.metadata.exposureId;
        activeMs = 0;
        interacted = false;
      }
      if (!current || current.retained || openRef.current || Date.now() - current.at >= EXIT_INTENT_RETENTION_WINDOW_MS) return;
      if (document.visibilityState === "visible" && document.hasFocus() && interacted) activeMs += elapsed;
      if (activeMs >= EXIT_INTENT_RETAIN_MS && track("retained")) {
        current.retained = true;
        remember(current);
      }
    }, 1_000);
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    window.addEventListener("wheel", activity, { passive: true });
    window.addEventListener("spc-cookie-consent", forgetWithoutConsent);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      window.removeEventListener("wheel", activity);
      window.removeEventListener("spc-cookie-consent", forgetWithoutConsent);
    };
  }, []);

  useEffect(() => {
    if (!identity || !eligible || !exitIntentPathAllowed(pathname)) return;
    const startedAt = Date.now();
    let pointerUsed = false;
    function moved(event: MouseEvent) { if (event.clientY > 10) pointerUsed = true; }
    function leaving(event: MouseEvent) {
      let closedUntil = 0;
      try { closedUntil = Number(window.localStorage.getItem(COOLDOWN_KEY)) || 0; } catch { /* In-memory cap remains. */ }
      if (shown.current || !isTopExit({
        clientY: event.clientY, relatedTarget: event.relatedTarget, pointerUsed,
        visible: document.visibilityState === "visible" && document.hasFocus(),
        desktop: window.matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)").matches,
        elapsedMs: Date.now() - startedAt, closedUntil, now: Date.now(),
      })) return;
      // Don't compete with consent, cart dialogs, or an in-progress form.
      const competing = [...document.querySelectorAll('[role="dialog"], [aria-label="Podešavanja kolačića"]')]
        .some(element => element.getClientRects().length > 0);
      if (competing || document.activeElement?.matches("input, textarea, select, [contenteditable=true]")) return;
      shown.current = true;
      try { window.localStorage.setItem(COOLDOWN_KEY, String(Date.now() + EXIT_INTENT_COOLDOWN_MS)); } catch { /* In-memory cap remains. */ }
      const context = getConsentedAnalyticsContext();
      exposure.current = null;
      if (context) {
        const metadata: ExitIntentMetadata = { campaign: EXIT_INTENT_CAMPAIGN, exposureId: crypto.randomUUID(), event: "impression", discountPct: firstPurchasePct, audience: customer ? "customer" : "guest" };
        if (recordFirstPartyEvent({ type: "EXIT_INTENT", path: pathname, metadata })) {
          exposure.current = { metadata, anonymousId: context.anonymousId, at: Date.now(), retained: false };
          remember(exposure.current);
        }
      }
      openRef.current = true;
      setOpenedFor(locationKey);
    }
    document.addEventListener("mousemove", moved, { passive: true });
    document.addEventListener("mouseout", leaving);
    return () => { document.removeEventListener("mousemove", moved); document.removeEventListener("mouseout", leaving); };
  }, [pathname, identity, eligible, customer, firstPurchasePct, locationKey]);

  if (!exitIntentPathAllowed(pathname) || !identity || !eligible) return null;
  const callbackUrl = encodeURIComponent(pathname === "/korpa" ? "/korpa" : pathname);
  const primary = "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#00366b] px-5 py-3 text-base font-semibold text-white transition hover:bg-[#002850] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#00366b]";

  return <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
    <DialogContent className="gap-0 overflow-x-hidden overflow-y-auto rounded-3xl bg-white p-0 shadow-2xl sm:max-w-[720px]" closeLabel="Zatvori ponudu" closeButtonClassName="top-4 right-4 z-10 rounded-full bg-white/90 text-ink-900">
      <div className="grid sm:grid-cols-[0.85fr_1.15fr]">
        <div className="relative flex flex-col justify-between overflow-hidden bg-[#00366b] p-9 text-white">
          <div aria-hidden className="pointer-events-none absolute -top-16 -left-20 size-64 rounded-full border-[32px] border-white/5" />
          <div className="relative flex items-center gap-2 text-sm font-semibold"><Gift className="size-5" aria-hidden /> Svet Povoljnih Cena</div>
          <div className="relative py-10">
            <p className="text-sm font-medium text-white/80">Za vašu prvu kupovinu</p>
            <div className="mt-2 font-display text-[80px] leading-none font-bold tracking-tight">−{firstPurchasePct}<span className="text-5xl">%</span></div>
            <p className="mt-4 max-w-44 text-lg leading-snug text-white/90">Mali razlog da još malo ostanete.</p>
          </div>
          <div className="relative flex items-center gap-2 text-xs text-white/80"><Check className="size-4" aria-hidden /> Popust se obračunava u korpi</div>
        </div>
        <div className="px-8 pt-12 pb-8">
          <p className="mb-3 text-xs font-bold tracking-widest text-action uppercase">Pre nego što odete</p>
          <DialogTitle className="font-display text-3xl leading-tight font-semibold text-ink-900">Prva kupovina,<br />povoljnija za {firstPurchasePct}%.</DialogTitle>
          <DialogDescription className="mt-4 text-base leading-relaxed text-ink-600">
            {customer ? "Vaš nalog ima pravo na popust za prvu kupovinu. Nastavite kupovinu i proverite obračun u korpi." : "Kreirajte nalog ili se prijavite i ostvarite popust za prvu kupovinu na sajtu."}
          </DialogDescription>
          <div className="mt-6 space-y-3">
            {customer ? <button type="button" className={primary} onClick={() => close("shop_clicked")}>Nastavi kupovinu <ArrowRight className="size-4" aria-hidden /></button> : <>
              <Link href={`/nalog/registracija?callbackUrl=${callbackUrl}`} className={primary} onClick={() => close("register_clicked")}>Kreiraj nalog za {firstPurchasePct}% <ArrowRight className="size-4" aria-hidden /></Link>
              <Link href={`/nalog/prijava?callbackUrl=${callbackUrl}`} className="flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold text-[#00366b] hover:bg-muted-bg" onClick={() => close("login_clicked")}>Već imam nalog — prijavi se</Link>
            </>}
          </div>
          <p className="mt-5 text-xs leading-relaxed text-ink-500">Važi za prvu kupovinu preko prijavljenog naloga na sajtu. Gost-loyalty kupovina i porudžbine preko poruka ne ostvaruju ovaj dodatni popust.</p>
          <button type="button" onClick={() => close()} className="mt-5 text-sm text-ink-600 underline underline-offset-4 hover:text-ink-900">Nastavi bez ponude</button>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
