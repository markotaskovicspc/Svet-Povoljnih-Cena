import { allowsAnalytics, allowsMarketing, type TrackingConsent } from "./tracking-consent";

export const CLARITY_PROJECT_ID = "yt36qdxjq6";
const SCRIPT_ID = "spc-clarity";
type Clarity = ((...args: unknown[]) => void) & { q?: unknown[][] };
type ClarityWindow = Window & { clarity?: Clarity };

export function isClarityPageAllowed(pathname: string, search = "") {
  const privatePaths = ["/admin", "/nalog", "/reklamacije/prijava", "/checkout/potvrda", "/checkout/nastavi", "/ponuda"];
  return !privatePaths.some(path => pathname === path || pathname.startsWith(`${path}/`)) &&
    !new URLSearchParams(search).has("token");
}

/** Load only after analytics consent. Keep one SDK across public SPA navigation. */
export function createClarityController(browser: ClarityWindow) {
  let initialized = false;
  let active = false;
  function stop() {
    if (!initialized || !active) return;
    browser.clarity?.("consentv2", { analytics_Storage: "denied", ad_Storage: "denied" });
    // Consent denial alone can leave Clarity running in cookieless mode.
    browser.clarity?.("stop");
    active = false;
  }
  function sync(consent: TrackingConsent | null, pathname: string, search = "") {
    if (!allowsAnalytics(consent) || !isClarityPageAllowed(pathname, search)) {
      stop();
      return;
    }
    if (!browser.clarity) {
      const queue: Clarity = (...args) => { (queue.q ??= []).push(args); };
      browser.clarity = queue;
    }
    browser.clarity("consentv2", {
      analytics_Storage: "granted",
      ad_Storage: allowsMarketing(consent) ? "granted" : "denied",
    });
    if (initialized && !active) browser.clarity("start");
    active = true;
    if (!initialized) {
      initialized = true;
      if (!browser.document.getElementById(SCRIPT_ID)) {
        const script = browser.document.createElement("script");
        script.id = SCRIPT_ID;
        script.async = true;
        script.src = `https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`;
        browser.document.head.appendChild(script);
      }
    }
  }
  return { sync, stop };
}
