import "server-only";

import type { SmallParcelProvider } from "@/lib/mygls/config";
import type { MyGlsPickupAddress } from "@/lib/mygls/config";
import type { XExpressConfig } from "@/lib/x-express/config";

export type RabaluxPickupSnapshot = {
  name: string;
  street: string;
  houseNumber: string;
  houseNumberInfo: string;
  city: string;
  postalCode: string;
  country: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
};

export type RabaluxProviderPickup =
  | {
      provider: "X_EXPRESS";
      pickup: XExpressConfig["pickup"];
      snapshot: RabaluxPickupSnapshot;
    }
  | {
      provider: "MYGLS";
      pickup: MyGlsPickupAddress;
      snapshot: RabaluxPickupSnapshot;
    };

/**
 * Rabalux currently dispatches from one fixed warehouse. Keep that address
 * separate from the merchant/DC courier variables so a dropship label can
 * never silently fall back to our own warehouse.
 */
export function requireRabaluxPickupForProvider(
  provider: SmallParcelProvider,
): RabaluxProviderPickup {
  const snapshot = requireSnapshot();
  if (provider === "MYGLS") {
    if (!/^\d/.test(snapshot.houseNumber)) {
      throw new Error(
        "RABALUX_PICKUP_HOUSE_NUMBER mora početi cifrom za MyGLS adresnicu.",
      );
    }
    return {
      provider,
      snapshot,
      pickup: {
        name: snapshot.name,
        street: snapshot.street,
        houseNumber: snapshot.houseNumber,
        houseNumberInfo: snapshot.houseNumberInfo,
        city: snapshot.city,
        postalCode: snapshot.postalCode,
        country: snapshot.country,
        contactName: snapshot.contactName,
        contactPhone: snapshot.contactPhone,
        contactEmail: snapshot.contactEmail,
      },
    };
  }

  const townId = positiveInteger("RABALUX_X_EXPRESS_TOWN_ID");
  const latitude = coordinate("RABALUX_X_EXPRESS_LATITUDE", 90);
  const longitude = coordinate("RABALUX_X_EXPRESS_LONGITUDE", 180);
  return {
    provider,
    snapshot,
    pickup: {
      name: snapshot.name,
      townId,
      streetName: value("RABALUX_X_EXPRESS_STREET_NAME") || snapshot.street,
      streetNumber:
        value("RABALUX_X_EXPRESS_STREET_NUMBER") || snapshot.houseNumber,
      latitude,
      longitude,
      description:
        value("RABALUX_PICKUP_DESCRIPTION") || "Rabalux dropship preuzimanje",
      contactName: snapshot.contactName,
      contactPhone: snapshot.contactPhone,
      contactEmail: snapshot.contactEmail,
    },
  };
}

function requireSnapshot(): RabaluxPickupSnapshot {
  const fields = {
    name: required("RABALUX_PICKUP_NAME"),
    street: required("RABALUX_PICKUP_STREET"),
    houseNumber: required("RABALUX_PICKUP_HOUSE_NUMBER"),
    houseNumberInfo: value("RABALUX_PICKUP_HOUSE_NUMBER_INFO"),
    city: required("RABALUX_PICKUP_CITY"),
    postalCode: required("RABALUX_PICKUP_POSTAL_CODE"),
    country: value("RABALUX_PICKUP_COUNTRY") || "RS",
    contactName: required("RABALUX_PICKUP_CONTACT_NAME"),
    contactPhone: required("RABALUX_PICKUP_CONTACT_PHONE"),
    contactEmail: required("RABALUX_PICKUP_CONTACT_EMAIL"),
  };
  if (!/^\d{5}$/.test(fields.postalCode)) {
    throw new Error("RABALUX_PICKUP_POSTAL_CODE mora imati pet cifara.");
  }
  return fields;
}

function required(name: string) {
  const current = value(name);
  if (!current) {
    throw new Error(`Rabalux pickup nije kompletan: nedostaje ${name}.`);
  }
  return current;
}

function positiveInteger(name: string) {
  const current = Number(required(name));
  if (!Number.isInteger(current) || current <= 0) {
    throw new Error(`${name} mora biti pozitivan ceo broj.`);
  }
  return current;
}

function coordinate(name: string, max: number) {
  const current = Number(required(name));
  if (!Number.isFinite(current) || Math.abs(current) > max) {
    throw new Error(`${name} nije validna koordinata.`);
  }
  return current;
}

function value(name: string) {
  const current = process.env[name]?.trim() ?? "";
  return current && !current.startsWith("GET_FROM_") ? current : "";
}
