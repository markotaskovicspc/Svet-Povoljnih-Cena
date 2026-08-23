export const CUSTOMER_CANCELLABLE_ORDER_STATUSES = [
  "KREIRANO",
  "POTVRDJENO",
  "U_PRIPREMI",
  "SPREMNO_ZA_ISPORUKU",
  "U_ISPORUCI",
] as const;

export function canCustomerCancelStatus(status: string) {
  return CUSTOMER_CANCELLABLE_ORDER_STATUSES.includes(
    status.toLocaleUpperCase("sr-Latn-RS") as (typeof CUSTOMER_CANCELLABLE_ORDER_STATUSES)[number],
  );
}

export class OrderCancellationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "NOT_ALLOWED"
      | "FISCALIZED"
      | "IN_PROGRESS",
  ) {
    super(message);
    this.name = "OrderCancellationError";
  }
}
