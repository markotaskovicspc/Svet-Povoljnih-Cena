/** Existing carrier identifiers only; no provider payloads or inferred transformations. */
export function shipmentExportReferences(shipment: {provider: string | null; providerOrderId?: string | null; providerParcelNumbers?: unknown}) {
 return {
  providerOrderId: shipment.provider === 'X_EXPRESS' ? shipment.providerOrderId ?? null : null,
  providerParcelNumbers: Array.isArray(shipment.providerParcelNumbers) ? shipment.providerParcelNumbers.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number' && Number.isSafeInteger(v)) : [],
 };
}
