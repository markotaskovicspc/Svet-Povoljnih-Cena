import "server-only";

import type { PaymentMethod } from "@prisma/client";

function accepted(name: string) {
  return ["1", "true", "yes", "on"].includes(
    (process.env[name] ?? "").trim().toLowerCase(),
  );
}

const PAYMENT_ACCEPTANCE: Partial<
  Record<PaymentMethod, { env: string; label: string }>
> = {
  IPS: {
    env: "IPS_PRODUCTION_ACCEPTED",
    label: "IPS produkcioni E2E",
  },
  KARTICA: {
    env: "RAIACCEPT_PRODUCTION_ACCEPTED",
    label: "RaiAccept produkcioni E2E",
  },
  GOOGLE_PAY: {
    env: "GOOGLE_PAY_PRODUCTION_ACCEPTED",
    label: "Google Pay produkcioni E2E",
  },
  APPLE_PAY: {
    env: "APPLE_PAY_PRODUCTION_ACCEPTED",
    label: "Apple Pay produkcioni E2E",
  },
};

export function getPaymentMethodAcceptance(method: PaymentMethod) {
  const gate = PAYMENT_ACCEPTANCE[method];
  if (!gate) {
    return { accepted: true, requirement: null, env: null };
  }
  return {
    accepted: accepted(gate.env),
    requirement: gate.label,
    env: gate.env,
  };
}

export function isProviderAccepted(env: string) {
  return accepted(env);
}
