"use client";

import { useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GoogleAnalytics } from "@next/third-parties/google";
import { MetaPixel } from "@/components/analytics/meta-pixel";
import { revokeMetaConsent } from "@/lib/analytics/meta-client";
import {
  allowsAnalytics,
  allowsMarketing,
  consentFromChoices,
  normalizeTrackingConsent,
  TRACKING_CONSENT_COOKIE,
  TRACKING_CONSENT_VERSION,
  TRACKING_CONSENT_VERSION_COOKIE,
  type TrackingConsent,
} from "@/lib/analytics/tracking-consent";
import { Button } from "@/components/ui/button";

function readConsent() {
  const match = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${TRACKING_CONSENT_COOKIE}=`));
  return normalizeTrackingConsent(match?.split("=")[1]);
}

function readConsentVersion() {
  return document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${TRACKING_CONSENT_VERSION_COOKIE}=`))
    ?.split("=")[1] ?? null;
}

function persistConsent(value: TrackingConsent) {
  const previous = readConsent();
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const attributes = `; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  document.cookie = `${TRACKING_CONSENT_COOKIE}=${value}${attributes}`;
  document.cookie = `${TRACKING_CONSENT_VERSION_COOKIE}=${TRACKING_CONSENT_VERSION}${attributes}`;
  if (allowsMarketing(previous) && !allowsMarketing(value)) {
    revokeMetaConsent();
  }
  window.dispatchEvent(new CustomEvent("spc-cookie-consent", { detail: value }));
}

function subscribe(onChange: () => void) {
  window.addEventListener("spc-cookie-consent", onChange);
  return () => window.removeEventListener("spc-cookie-consent", onChange);
}

function useCookieConsent() {
  return useSyncExternalStore(subscribe, readConsent, () => null);
}

function useCookieConsentVersion() {
  return useSyncExternalStore(subscribe, readConsentVersion, () => null);
}

export function CookieConsent({
  gaId,
  metaPixelId,
}: {
  gaId?: string;
  metaPixelId?: string | null;
}) {
  const consent = useCookieConsent();
  const consentVersion = useCookieConsentVersion();
  const pathname = usePathname();
  const metaConfigured = Boolean(metaPixelId);
  const shouldPrompt =
    consent === null ||
    (metaConfigured && consentVersion !== TRACKING_CONSENT_VERSION);

  if (pathname.startsWith("/admin")) return null;

  return (
    <>
      {gaId && allowsAnalytics(consent) ? <GoogleAnalytics gaId={gaId} /> : null}
      {metaPixelId && allowsMarketing(consent) ? (
        <MetaPixel pixelId={metaPixelId} />
      ) : null}
      {shouldPrompt ? (
        <aside
          aria-label="Podešavanja kolačića"
          className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-3xl rounded-xl border border-border bg-white p-4 shadow-2xl md:flex md:items-center md:gap-5 md:p-5"
        >
          <div className="flex-1">
            <p className="font-display text-lg text-ink-900">Vaša privatnost</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">
              Nužni kolačići omogućavaju prijavu i korpu. Analitiku
              {metaConfigured ? " i Meta marketing" : ""} uključujemo samo uz
              vaš izbor. {" "}
              <Link href="/politika-privatnosti" className="text-walnut underline">
                Detalji
              </Link>
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 md:mt-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => persistConsent("essential")}
            >
              Samo nužni
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => persistConsent("analytics")}
            >
              Samo analitika
            </Button>
            {metaConfigured ? (
              <Button type="button" onClick={() => persistConsent("all")}>
                Prihvati sve
              </Button>
            ) : null}
          </div>
        </aside>
      ) : null}
    </>
  );
}

export function CookieSettingsPanel({
  gaConfigured,
  metaConfigured,
}: {
  gaConfigured: boolean;
  metaConfigured: boolean;
}) {
  const consent = useCookieConsent();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    persistConsent(
      consentFromChoices({
        analytics: data.get("analytics") === "on",
        marketing: data.get("marketing") === "on",
      }),
    );
  }

  return (
    <form
      key={consent ?? "unset"}
      onSubmit={save}
      className="rounded-xl border border-border/70 bg-surface p-5"
    >
      <p className="text-sm text-ink-600">
        Nužni kolačići su uvek aktivni. Ostale kategorije možete nezavisno
        uključiti ili povući saglasnost u svakom trenutku.
      </p>
      <div className="mt-4 space-y-3">
        <label className="flex items-start gap-3 rounded-lg border border-border bg-white p-3">
          <input
            name="analytics"
            type="checkbox"
            defaultChecked={allowsAnalytics(consent)}
            className="mt-1 size-4"
          />
          <span className="text-sm text-ink-700">
            <strong>Analitika</strong> — Google Analytics i interna statistika.
            Sistem je {gaConfigured ? "tehnički konfigurisan" : "trenutno nekonfigurisan"}.
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-border bg-white p-3">
          <input
            name="marketing"
            type="checkbox"
            defaultChecked={allowsMarketing(consent)}
            disabled={!metaConfigured}
            className="mt-1 size-4"
          />
          <span className="text-sm text-ink-700">
            <strong>Marketing</strong> — Meta Pixel i, kada je uključen,
            Conversions API. Sistem je {metaConfigured ? "tehnički konfigurisan" : "trenutno nekonfigurisan"}.
          </span>
        </label>
      </div>
      <Button type="submit" className="mt-4">
        Sačuvaj izbor
      </Button>
    </form>
  );
}
