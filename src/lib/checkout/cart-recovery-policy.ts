import "server-only";

import { getEmailConfig } from "@/lib/email/config";

export const CART_RECOVERY_MAX_STEPS = 3;

const NEXT_DELAY_MS: Record<number, number | null> = {
  0: 60 * 60 * 1000,
  1: 23 * 60 * 60 * 1000,
  2: 24 * 60 * 60 * 1000,
  3: null,
};

export function nextCartRecoverySendAt(activityAt: Date, completedStep: number) {
  const normalizedStep = Math.min(
    Math.max(Math.trunc(completedStep || 0), 0),
    CART_RECOVERY_MAX_STEPS,
  );
  const delay = NEXT_DELAY_MS[normalizedStep];
  return delay == null ? null : new Date(activityAt.getTime() + delay);
}

export function isCartRecoveryEnabled() {
  const requested = /^(1|true|yes|on)$/i.test(
    process.env.ABANDONED_CART_RECOVERY_ENABLED?.trim() ?? "",
  );
  if (!requested) return false;
  const email = getEmailConfig();
  return (
    email.provider === "ses" &&
    email.sesCredentialsConfigured &&
    Boolean(email.unsubscribeSecret)
  );
}

export function cartRecoverySubject(step: number, discountPercent = 0) {
  if (step === 1) return "Proizvodi su ostali u vašoj korpi";
  if (step === 2) return "Vaša korpa vas još čeka";
  return discountPercent > 0
    ? `${discountPercent}% popusta za završetak kupovine`
    : "Poslednji podsetnik za vašu korpu";
}
