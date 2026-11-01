"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { commerceTermsAt, OCTOBER_TERMS_AT_MS, FIRST_PURCHASE_FIVE_PERCENT_AT_MS } from "@/lib/commerce-terms";

const TermsContext = createContext<ReturnType<typeof commerceTermsAt> | null>(null);
const snapshot = () => commerceTermsAt();

function subscribe(notify: () => void) {
  // A cart left open over midnight must reprice and request a fresh delivery quote.
  const now = Date.now();
  const nextChange = [OCTOBER_TERMS_AT_MS, FIRST_PURCHASE_FIVE_PERCENT_AT_MS].find(at => at > now);
  const timeout = nextChange == null ? undefined : window.setTimeout(notify, Math.min(2_147_483_647, nextChange - now + 1));
  window.addEventListener("focus", notify);
  document.addEventListener("visibilitychange", notify);
  return () => {
    window.clearTimeout(timeout);
    window.removeEventListener("focus", notify);
    document.removeEventListener("visibilitychange", notify);
  };
}

export function CommerceTermsProvider({ initialAt, children }: { initialAt: number; children: ReactNode }) {
  // Serialized server time keeps cached HTML and hydration consistent. Immediately
  // after hydration the client snapshot switches to the current scheduled terms.
  const terms = useSyncExternalStore(subscribe, snapshot, () => commerceTermsAt(initialAt));
  return <TermsContext.Provider value={terms}>{children}</TermsContext.Provider>;
}

export function useCommerceTerms() {
  return useContext(TermsContext) ?? commerceTermsAt();
}
