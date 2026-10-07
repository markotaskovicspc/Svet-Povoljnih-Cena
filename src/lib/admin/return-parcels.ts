export type ReturnShipment = {
  id: string;
  provider?: string | null;
  trackingNo?: string | null;
  packageCount?: number;
  providerParcelNumbers?: unknown;
  returnArrivals?: { parcelNumber: string }[];
};

export function normalizeReturnParcelNumber(value: string) {
  const code = value.replace(/\s/g, "").toUpperCase();
  return /^\d+$/.test(code) ? code.replace(/^0+(?=\d)/, "") : code;
}

export function returnParcelNumbers(shipment: ReturnShipment) {
  const numbers = Array.isArray(shipment.providerParcelNumbers)
    ? shipment.providerParcelNumbers.filter(
        (value): value is string | number =>
          typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value)),
      ).map(String)
    : [];
  // trackingNo is normally the first parcel, not a separate shipment code.
  if (!numbers.length && shipment.trackingNo) numbers.push(shipment.trackingNo);
  return [...new Set(numbers.map(normalizeReturnParcelNumber).filter(Boolean))];
}

export function displayReturnParcelNumber(code: string, provider?: string | null) {
  return provider === "MYGLS" && /^\d+$/.test(code) ? code.padStart(11, "0") : code;
}

export function returnParcelArrived(shipment: ReturnShipment, code: string) {
  return shipment.returnArrivals?.some(
    (arrival) => normalizeReturnParcelNumber(arrival.parcelNumber) === normalizeReturnParcelNumber(code),
  ) ?? false;
}
