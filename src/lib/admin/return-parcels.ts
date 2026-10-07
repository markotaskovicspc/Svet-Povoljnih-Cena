export type ReturnShipment = {
  id: string;
  provider?: string | null;
  trackingNo?: string | null;
  packageCount?: number;
  providerParcelNumbers?: unknown;
  rawCreateResponse?: unknown;
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

/** Match saved parcel contents, never the order of products on screen. */
export function returnItemParcelNumbers(
  item: { id: string; sku: string },
  shipments: readonly ReturnShipment[],
) {
  return shipments.flatMap((shipment) => {
    const codes = returnParcelNumbers(shipment);
    const raw = shipment.rawCreateResponse;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const data = raw as Record<string, unknown>;
    const labels = shipment.provider === "MYGLS"
      ? data.myGlsPackageAssignments : data.articleLabels;
    if (!Array.isArray(labels)) return [];
    return labels.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const label = entry as Record<string, unknown>;
      const packed = Array.isArray(label.packedItems) ? label.packedItems : [];
      const matches = shipment.provider === "MYGLS"
        ? label.orderItemId === item.id
        : packed.length
          ? packed.some((value) => value && typeof value === "object" && value.orderItemId === item.id)
          : label.sku === item.sku;
      const value = shipment.provider === "MYGLS" ? label.parcelNumber : label.Code;
      if (!matches || (typeof value !== "string" && typeof value !== "number")) return [];
      const code = normalizeReturnParcelNumber(String(value));
      const packedItem = packed.find((value) => value && typeof value === "object" && value.orderItemId === item.id);
      const quantity = packedItem?.quantity ?? label.packedQuantity;
      return codes.includes(code) ? [{ shipment, code,
        quantity: Number.isSafeInteger(quantity) && Number(quantity) > 0 ? Number(quantity) : undefined,
      }] : [];
    });
  });
}

export function returnUnitParcelNumbers(
  item: { id: string; sku: string; qty: number },
  shipments: readonly ReturnShipment[],
  unitNo: number,
) {
  const parcels = returnItemParcelNumbers(item, shipments);
  // Split identical units only when the complete saved packing quantities
  // account for the item. Otherwise show the candidate parcels explicitly.
  if (parcels.some((parcel) => !parcel.quantity) ||
      parcels.reduce((sum, parcel) => sum + (parcel.quantity ?? 0), 0) !== item.qty) {
    return { parcels, exact: false };
  }
  let offset = 0;
  const parcel = parcels.find((parcel) => {
    offset += parcel.quantity!;
    return unitNo <= offset;
  });
  return { parcels: parcel ? [parcel] : [], exact: Boolean(parcel) };
}
