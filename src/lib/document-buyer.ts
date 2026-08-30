export type DocumentBuyerAddress = {
  companyName?: string | null;
  pib?: string | null;
};

export type OrderDocumentBuyerSnapshot = {
  billingSameAsShipping: boolean;
  shipFirstName: string;
  shipLastName: string;
  shipStreet: string;
  shipPostalCode: string;
  shipCity: string;
  shipCompanyName?: string | null;
  shipPib?: string | null;
  billFirstName?: string | null;
  billLastName?: string | null;
  billStreet?: string | null;
  billPostalCode?: string | null;
  billCity?: string | null;
  billCompanyName?: string | null;
  billPib?: string | null;
};

export type ResolvedOrderDocumentBuyer = DocumentBuyerAddress & {
  source: "shipping" | "billing";
  firstName: string;
  lastName: string;
  street: string;
  postalCode: string;
  city: string;
};

export function hasBusinessIdentity(
  address: DocumentBuyerAddress | null | undefined,
) {
  return Boolean(address?.companyName?.trim() || address?.pib?.trim());
}

function businessIdentityScore(
  address: DocumentBuyerAddress | null | undefined,
) {
  return Number(Boolean(address?.companyName?.trim())) +
    Number(Boolean(address?.pib?.trim()));
}

/**
 * A legal identity must not be lost just because checkout also contains a
 * separate personal billing address. Prefer a business billing address when
 * present, otherwise the business shipping address, then the ordinary billing
 * fallback used for consumers.
 */
export function resolveDocumentBuyerAddress<T extends DocumentBuyerAddress>(
  shippingAddress: T,
  billingAddress?: T | null,
): T {
  const billingScore = businessIdentityScore(billingAddress);
  const shippingScore = businessIdentityScore(shippingAddress);
  if (billingAddress && billingScore === 2) {
    return billingAddress;
  }
  if (shippingScore === 2) return shippingAddress;
  if (billingAddress && billingScore > 0) return billingAddress;
  if (shippingScore > 0) return shippingAddress;
  return billingAddress ?? shippingAddress;
}

export function resolveOrderDocumentBuyerAddress(
  order: OrderDocumentBuyerSnapshot,
): ResolvedOrderDocumentBuyer {
  const shippingAddress: ResolvedOrderDocumentBuyer = {
    source: "shipping",
    firstName: order.shipFirstName,
    lastName: order.shipLastName,
    companyName: order.shipCompanyName,
    pib: order.shipPib,
    street: order.shipStreet,
    postalCode: order.shipPostalCode,
    city: order.shipCity,
  };
  const billingAddress: ResolvedOrderDocumentBuyer | null =
    !order.billingSameAsShipping && order.billFirstName
      ? {
          source: "billing",
          firstName: order.billFirstName,
          lastName: order.billLastName ?? "",
          companyName: order.billCompanyName,
          pib: order.billPib,
          street: order.billStreet ?? "",
          postalCode: order.billPostalCode ?? "",
          city: order.billCity ?? "",
        }
      : null;

  return resolveDocumentBuyerAddress(shippingAddress, billingAddress);
}
