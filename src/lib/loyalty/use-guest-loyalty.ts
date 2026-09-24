"use client";
import { useEffect } from "react";
import { create } from "zustand";

type LoyaltyStatus = { active: boolean; email: string | null; firstPurchase: boolean; ready: boolean; pending: boolean };
const useStatus = create<LoyaltyStatus>(() => ({ active: false, email: null, firstPurchase: false, ready: false, pending: false }));
let pending: Promise<void> | null = null;
let refreshedAt = 0;
let revision = 0;

export function activateGuestLoyalty() {
  revision += 1;
  useStatus.setState({ active: true, email: null, firstPurchase: false, ready: true, pending: false });
}

export function refreshGuestLoyalty() {
  if (pending) return pending;
  const requestedRevision = revision;
  pending = fetch("/api/loyalty/status", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Loyalty status unavailable");
      const data = await response.json();
      if (requestedRevision !== revision) return;
      useStatus.setState({ active: data.active === true, email: typeof data.email === "string" ? data.email : null, firstPurchase: data.firstPurchase === true, ready: true, pending: data.pending === true });
    })
    .catch(() => { if (requestedRevision === revision) useStatus.setState({ active: false, email: null, firstPurchase: false, ready: true }); })
    .finally(() => { pending = null; refreshedAt = Date.now(); });
  return pending;
}

export function useGuestLoyalty() {
  const status = useStatus();
  useEffect(() => {
    if (!status.pending) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - refreshedAt > 5000) void refreshGuestLoyalty();
    }, 6000);
    return () => window.clearInterval(interval);
  }, [status.pending]);
  useEffect(() => {
    const refresh = () => { if (Date.now() - refreshedAt > 1000) void refreshGuestLoyalty(); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", refresh); };
  }, []);
  return status;
}
