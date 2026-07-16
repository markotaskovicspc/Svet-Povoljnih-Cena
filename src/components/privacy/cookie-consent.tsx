"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Button } from "@/components/ui/button";

type Consent = "analytics" | "essential";
const COOKIE = "spc_cookie_consent";

function readConsent(): Consent | null {
  const match = document.cookie.split("; ").find((item) => item.startsWith(`${COOKIE}=`));
  const value = match?.split("=")[1];
  return value === "analytics" || value === "essential" ? value : null;
}

function persistConsent(value: Consent) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  window.dispatchEvent(new CustomEvent("spc-cookie-consent", { detail: value }));
}

function subscribe(onChange: () => void) {
  window.addEventListener("spc-cookie-consent", onChange);
  return () => window.removeEventListener("spc-cookie-consent", onChange);
}

function useCookieConsent() {
  return useSyncExternalStore(subscribe, readConsent, () => null);
}

export function CookieConsent({ gaId }: { gaId?: string }) {
  const consent = useCookieConsent();
  const pathname = usePathname();

  function choose(value: Consent) {
    persistConsent(value);
  }

  if (pathname.startsWith("/admin")) return null;

  return (
    <>
      {gaId && consent === "analytics" ? <GoogleAnalytics gaId={gaId} /> : null}
      {consent === null ? (
        <aside aria-label="Podešavanja kolačića" className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-3xl rounded-xl border border-border bg-white p-4 shadow-2xl md:flex md:items-center md:gap-5 md:p-5">
          <div className="flex-1">
            <p className="font-display text-lg text-ink-900">Vaša privatnost</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">
              Nužni kolačići omogućavaju prijavu i korpu. Analitiku uključujemo samo uz vaš pristanak. <Link href="/politika-privatnosti" className="text-walnut underline">Detalji</Link>
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 md:mt-0">
            <Button type="button" variant="outline" onClick={() => choose("essential")}>Samo nužni</Button>
            <Button type="button" onClick={() => choose("analytics")}>Prihvati analitiku</Button>
          </div>
        </aside>
      ) : null}
    </>
  );
}

export function CookieSettingsPanel({ gaConfigured }: { gaConfigured: boolean }) {
  const consent = useCookieConsent();
  function choose(value: Consent) {
    persistConsent(value);
  }
  return (
    <div className="rounded-xl border border-border/70 bg-surface p-5">
      <p className="text-sm text-ink-600">Trenutno podešavanje: <strong>{consent === "analytics" ? "nužni i analitički" : "samo nužni"}</strong>.</p>
      <p className="mt-2 text-sm text-ink-500">Google Analytics je {gaConfigured ? "tehnički konfigurisan" : "trenutno nekonfigurisan"}; bez pristanka se ne učitava.</p>
      <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" onClick={() => choose("essential")}>Samo nužni</Button><Button onClick={() => choose("analytics")}>Dozvoli analitiku</Button></div>
    </div>
  );
}
