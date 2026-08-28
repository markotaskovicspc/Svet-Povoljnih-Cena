import type { PaymentMethod, PaymentStatus } from "@prisma/client";

export const EDITABLE_WEB_ORDER_PAYMENT_METHODS = [
  "UPLATA_NA_RACUN",
  "POUZECE_GOTOVINA",
  "POUZECE_KARTICA",
] as const satisfies readonly PaymentMethod[];

export type EditableWebOrderPaymentMethod =
  (typeof EDITABLE_WEB_ORDER_PAYMENT_METHODS)[number];

export function isEditableWebOrderPaymentMethod(
  value: PaymentMethod,
): value is EditableWebOrderPaymentMethod {
  return EDITABLE_WEB_ORDER_PAYMENT_METHODS.includes(
    value as EditableWebOrderPaymentMethod,
  );
}

type PaymentAttempt = {
  status: PaymentStatus;
  providerRef: string | null;
  paymentReference: string | null;
  redirectUrl: string | null;
  hasRawRequest: boolean;
  hasRawResponse: boolean;
};

export function planWebOrderPaymentMethodChange(input: {
  currentMethod: PaymentMethod;
  nextMethod: PaymentMethod;
  businessBuyer: boolean;
  mixedRabaluxOrder: boolean;
  attempts: PaymentAttempt[];
}) {
  if (!isEditableWebOrderPaymentMethod(input.nextMethod)) {
    throw new Error(
      "Na postojećoj WEB porudžbini mogu se izabrati samo uplata na račun ili plaćanje pouzećem.",
    );
  }
  if (input.currentMethod === input.nextMethod) {
    throw new Error("Izabrani način plaćanja je već aktivan.");
  }
  if (input.businessBuyer && input.nextMethod !== "UPLATA_NA_RACUN") {
    throw new Error("Pravno lice može da plati samo uplatom na račun.");
  }
  if (
    input.mixedRabaluxOrder &&
    ["POUZECE_GOTOVINA", "POUZECE_KARTICA"].includes(input.nextMethod)
  ) {
    throw new Error(
      "Mešovita DC + Rabalux porudžbina ne može da se prebaci na pouzeće dok se ne definiše raspodela otkupnine.",
    );
  }
  if (
    input.attempts.some((attempt) =>
      ["AUTHORIZED", "PAID", "PARTIAL_REFUND", "REFUNDED"].includes(
        attempt.status,
      ),
    )
  ) {
    throw new Error(
      "Plaćanje je već autorizovano, naplaćeno ili refundirano i ne može da se promeni.",
    );
  }
  const activeExternalAttempt = input.attempts.find(
    (attempt) =>
      attempt.status === "PENDING" &&
      Boolean(
        attempt.providerRef ||
          attempt.paymentReference ||
          attempt.redirectUrl ||
          attempt.hasRawRequest ||
          attempt.hasRawResponse,
      ),
  );
  if (activeExternalAttempt) {
    throw new Error(
      "Online plaćanje je već pokrenuto. Prvo proverite njegov status pre promene načina plaćanja.",
    );
  }

  const wasCashOnDelivery = [
    "POUZECE_GOTOVINA",
    "POUZECE_KARTICA",
  ].includes(input.currentMethod);
  const willBeCashOnDelivery = [
    "POUZECE_GOTOVINA",
    "POUZECE_KARTICA",
  ].includes(input.nextMethod);

  return {
    invalidatePendingAttempts: input.attempts.filter(
      (attempt) => attempt.status === "PENDING",
    ).length,
    supplierReadinessChanged:
      wasCashOnDelivery !== willBeCashOnDelivery,
    willBeCashOnDelivery,
  };
}
