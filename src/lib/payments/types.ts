import type { PaymentMethod, PaymentProvider } from "@prisma/client";

export interface CreatePaymentResult {
  provider: PaymentProvider;
  providerRef: string | null;
  paymentReference: string | null;
  redirectUrl: string | null;
  rawRequest: Record<string, unknown>;
  rawResponse: unknown;
  expiresAt: Date | null;
}

export interface PaymentStatusResult {
  paid: boolean;
  responseCode: string;
  providerRef: string | null;
  paymentReference: string | null;
  rawRequest: Record<string, unknown>;
  rawResponse: unknown;
}

export interface RefundPaymentResult {
  refunded: boolean;
  responseCode: string;
  rawRequest: Record<string, unknown>;
  rawResponse: unknown;
}

export interface PaymentProviderAdapter {
  createPayment(
    orderId: string,
    amount: number,
    method: PaymentMethod,
  ): Promise<CreatePaymentResult>;
  handleCallback(providerPayload: unknown): Promise<PaymentStatusResult>;
  checkPaymentStatus(orderId: string): Promise<PaymentStatusResult>;
  refundPayment(orderId: string, amount: number): Promise<RefundPaymentResult>;
}

export function providerForPaymentMethod(method: PaymentMethod): PaymentProvider {
  switch (method) {
    case "IPS":
      return "IPS";
    case "KARTICA":
    case "GOOGLE_PAY":
    case "APPLE_PAY":
      return "RAIFFEISEN_CARD";
    case "POUZECE_GOTOVINA":
    case "POUZECE_KARTICA":
      return "COD";
    case "UPLATA_NA_RACUN":
    default:
      return "MANUAL";
  }
}
