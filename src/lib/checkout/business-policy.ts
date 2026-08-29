export type CheckoutBusinessAddress = {
  liceType?: "fizicko" | "pravno";
  companyName?: string | null;
  pib?: string | null;
};

export function missingBusinessAddressFields(address: CheckoutBusinessAddress) {
  if (address.liceType !== "pravno") return [];
  return [
    address.companyName?.trim() ? null : "companyName",
    address.pib?.trim() ? null : "pib",
  ].filter((field): field is "companyName" | "pib" => field !== null);
}

export function shouldRestoreBusinessBuyerType(input: {
  current: "fizicko" | "pravno" | undefined;
  remembered: "fizicko" | "pravno" | undefined;
  dirty: boolean;
}) {
  return (
    !input.dirty &&
    input.current === "fizicko" &&
    input.remembered === "pravno"
  );
}

export function checkoutBusinessIdentityMatchesOrder(
  input: {
    shipping: CheckoutBusinessAddress;
    billing?: CheckoutBusinessAddress | null;
    paymentMethod: string;
  },
  order: {
    paymentMethod: string;
    shipCompanyName: string | null;
    shipPib: string | null;
    billCompanyName: string | null;
    billPib: string | null;
  },
) {
  const clean = (value: string | null | undefined) => value?.trim() || null;
  return (
    input.paymentMethod === order.paymentMethod &&
    clean(input.shipping.companyName) === clean(order.shipCompanyName) &&
    clean(input.shipping.pib) === clean(order.shipPib) &&
    clean(input.billing?.companyName) === clean(order.billCompanyName) &&
    clean(input.billing?.pib) === clean(order.billPib)
  );
}
