"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { commerceTermsAt, OCTOBER_TERMS_AT_MS } from "@/lib/commerce-terms";

const TermsContext = createContext<ReturnType<typeof commerceTermsAt> | null>(null);
const snapshot = () => Date.now() >= OCTOBER_TERMS_AT_MS;

function subscribe(notify: () => void) {
  // A cart left open over midnight must reprice and request a fresh delivery quote.
  const timeout = window.setTimeout(notify, Math.min(2_147_483_647, Math.max(0, OCTOBER_TERMS_AT_MS - Date.now()) + 1));
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
  const october = useSyncExternalStore(subscribe, snapshot, () => initialAt >= OCTOBER_TERMS_AT_MS);
  return <TermsContext.Provider value={commerceTermsAt(october ? OCTOBER_TERMS_AT_MS : OCTOBER_TERMS_AT_MS - 1)}>{children}</TermsContext.Provider>;
}

export function useCommerceTerms() {
  return useContext(TermsContext) ?? commerceTermsAt();
}
