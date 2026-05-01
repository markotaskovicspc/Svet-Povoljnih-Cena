"use client";

/**
 * Checkout flow state — transient UI store.
 *
 * Holds: which step is active, identity choice, voucher application result, and
 * a snapshot of the placed order (used by `/checkout/potvrda` after submit).
 * Address / payment / shipping fields live inside react-hook-form on the page;
 * they are copied here only on final submit so the confirmation page can render
 * a summary without re-reading the cart (cart gets cleared post-submit).
 */
import { create } from "zustand";
import type { Address, Order, PaymentMethod, ShippingMethod } from "@/types";

export type CheckoutStep =
  | "identity"
  | "shipping"
  | "method"
  | "payment"
  | "review";

export type IdentityChoice = "login" | "register" | "guest";

export interface AppliedVoucher {
  code: string;
  /** Fraction (0–1) discount on subtotal, applied after sale prices. */
  amount: number;
  /** Display label (e.g. "−10%" or "−1.500 RSD"). */
  label: string;
}

interface CheckoutState {
  step: CheckoutStep;
  identity: IdentityChoice | null;
  voucher: AppliedVoucher | null;
  /** Last successful submission, surfaced by `/checkout/potvrda`. */
  lastOrder: Order | null;
  setStep: (s: CheckoutStep) => void;
  setIdentity: (i: IdentityChoice) => void;
  applyVoucher: (v: AppliedVoucher | null) => void;
  setLastOrder: (o: Order | null) => void;
  reset: () => void;
}

export const useCheckout = create<CheckoutState>()((set) => ({
  step: "identity",
  identity: null,
  voucher: null,
  lastOrder: null,
  setStep: (step) => set({ step }),
  setIdentity: (identity) => set({ identity }),
  applyVoucher: (voucher) => set({ voucher }),
  setLastOrder: (lastOrder) => set({ lastOrder }),
  reset: () =>
    set({
      step: "identity",
      identity: null,
      voucher: null,
      lastOrder: null,
    }),
}));

/**
 * Mocked voucher table — replaced by `POST /api/voucher/validate` in Phase 3.
 * Keys are uppercased; lookups happen via `validateVoucher` below.
 */
const MOCK_VOUCHERS: Record<string, AppliedVoucher> = {
  "SPRING-10": { code: "SPRING-10", amount: 0.1, label: "−10%" },
  "WELCOME-5": { code: "WELCOME-5", amount: 0.05, label: "−5%" },
  "SPC-1500": { code: "SPC-1500", amount: 0, label: "−1.500 RSD" },
};

export function validateVoucher(
  raw: string,
  subtotal: number,
): { ok: true; voucher: AppliedVoucher } | { ok: false; reason: string } {
  const code = raw.trim().toUpperCase();
  if (!code) return { ok: false, reason: "Unesite kod" };
  const hit = MOCK_VOUCHERS[code];
  if (!hit) return { ok: false, reason: "Kod nije pronađen ili je istekao" };
  // Special-case fixed-amount vouchers stored as RSD in label
  if (code === "SPC-1500") {
    if (subtotal < 10000)
      return {
        ok: false,
        reason: "Vaučer važi samo za porudžbine preko 10.000 RSD",
      };
    return {
      ok: true,
      voucher: { ...hit, amount: 1500 / subtotal },
    };
  }
  return { ok: true, voucher: hit };
}

/**
 * Pricing constants. Real prices come from delivery rules in Phase 3 (admin-driven).
 */
export const SHIPPING_PRICES: Record<ShippingMethod, number> = {
  kurir: 990,
  kamion: 4990,
};

export const ASSEMBLY_PRICE_DEFAULT = 2990;

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  ips: "IPS NBS",
  kartica: "Platna kartica",
  google_pay: "Google Pay",
  apple_pay: "Apple Pay",
  uplata_na_racun: "Uplata na račun",
  pouzece_gotovina: "Pouzeće — gotovina",
  pouzece_kartica: "Pouzeće — kartica",
};

export type AddressDraft = Omit<Address, "id"> & { liceType?: "fizicko" | "pravno" };
