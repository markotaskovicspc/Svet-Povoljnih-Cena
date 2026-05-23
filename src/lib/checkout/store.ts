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
  /** Validated discount in RSD, already clamped by server pricing rules. */
  discountRsd: number;
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
  identity: "guest",
  voucher: null,
  lastOrder: null,
  setStep: (step) => set({ step }),
  setIdentity: (identity) => set({ identity }),
  applyVoucher: (voucher) => set({ voucher }),
  setLastOrder: (lastOrder) => set({ lastOrder }),
  reset: () =>
    set({
      step: "identity",
      identity: "guest",
      voucher: null,
      lastOrder: null,
    }),
}));

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
