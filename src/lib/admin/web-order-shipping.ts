export type WebOrderShippingEditShipment = {
  id: string;
  purpose: string;
  status: string;
  provider: string | null;
  providerShipmentId: string | null;
  trackingNo: string | null;
  rawCreateResponse?: unknown;
};

export type WebOrderShippingEditPlan =
  | {
      kind: "NO_WAYBILL";
      activeShipments: WebOrderShippingEditShipment[];
      manuallyCancelledXExpressShipments: [];
    }
  | {
      kind: "REPLACE_WAYBILLS";
      activeShipments: WebOrderShippingEditShipment[];
      manuallyCancelledXExpressShipments: WebOrderShippingEditShipment[];
    }
  | {
      kind: "BLOCKED";
      activeShipments: WebOrderShippingEditShipment[];
      manuallyCancelledXExpressShipments: WebOrderShippingEditShipment[];
      reason: string;
    };

export type WebOrderShippingAddressInput = {
  street: string;
  city: string;
  postalCode: string;
};

function normalizedText(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function requiredText(value: unknown, label: string, min: number, max: number) {
  const normalized = normalizedText(value);
  if (normalized.length < min) {
    throw new Error(`${label} je obavezno.`);
  }
  if (normalized.length > max) {
    throw new Error(`${label} može imati najviše ${max} karaktera.`);
  }
  return normalized;
}

export function normalizeWebOrderShippingAddress(input: {
  street: unknown;
  city: unknown;
  postalCode: unknown;
}): WebOrderShippingAddressInput {
  const street = requiredText(input.street, "Ulica i broj", 3, 200);
  const city = requiredText(input.city, "Grad / mesto", 2, 80);
  const postalCode = normalizedText(input.postalCode);
  if (!/^\d{5}$/.test(postalCode)) {
    throw new Error("Poštanski broj mora imati 5 cifara.");
  }
  return { street, city, postalCode };
}

export function normalizeWebOrderShippingPhone(value: unknown) {
  let digits = normalizedText(value).replace(/\D/g, "");
  if (digits.startsWith("00381")) digits = `0${digits.slice(5)}`;
  else if (digits.startsWith("381")) digits = `0${digits.slice(3)}`;
  if (!/^06\d{7,8}$/.test(digits)) {
    throw new Error(
      "Unesite 9 ili 10 cifara; broj telefona mora početi sa 06.",
    );
  }
  return digits;
}

export function planWebOrderShippingEdit(
  shipments: readonly WebOrderShippingEditShipment[],
): WebOrderShippingEditPlan {
  const activeShipments = shipments.filter(
    (shipment) =>
      shipment.purpose === "ORDER_DELIVERY" && shipment.status !== "FAILED",
  );
  const manuallyCancelledXExpressShipments = activeShipments.filter(
    (shipment) =>
      shipment.provider === "X_EXPRESS" && Boolean(shipment.providerShipmentId),
  );

  if (activeShipments.length === 0) {
    return {
      kind: "NO_WAYBILL",
      activeShipments,
      manuallyCancelledXExpressShipments: [],
    };
  }

  const handedToCourier = activeShipments.find(
    (shipment) => shipment.status !== "CREATED",
  );
  if (handedToCourier) {
    return {
      kind: "BLOCKED",
      activeShipments,
      manuallyCancelledXExpressShipments,
      reason:
        "Pošiljka je već preuzeta ili je u transportu. Izmenu prvo usaglasite sa kurirom.",
    };
  }

  const unsupported = activeShipments.find(
    (shipment) =>
      shipment.provider !== "MYGLS" && shipment.provider !== "X_EXPRESS",
  );
  if (unsupported) {
    return {
      kind: "BLOCKED",
      activeShipments,
      manuallyCancelledXExpressShipments,
      reason:
        "Aktivna adresnica nema podržano automatsko poništavanje. Prvo je ručno poništite.",
    };
  }

  return {
    kind: "REPLACE_WAYBILLS",
    activeShipments,
    manuallyCancelledXExpressShipments,
  };
}

export function shippingEditWaybillQuestion(plan: WebOrderShippingEditPlan) {
  if (plan.kind !== "REPLACE_WAYBILLS") return null;
  return plan.activeShipments.length === 1
    ? "Postoji aktivna adresnica. Da li želite da poništimo staru i napravimo novu sa ispravljenim podacima?"
    : "Postoje aktivne adresnice. Da li želite da poništimo stare i napravimo nove sa ispravljenim podacima?";
}
