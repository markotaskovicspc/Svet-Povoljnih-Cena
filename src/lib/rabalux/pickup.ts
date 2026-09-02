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

type Environment = Readonly<Record<string, string | undefined>>;

const COMMON_REQUIRED_FIELDS = [
  "RABALUX_PICKUP_NAME",
  "RABALUX_PICKUP_STREET",
  "RABALUX_PICKUP_HOUSE_NUMBER",
  "RABALUX_PICKUP_CITY",
  "RABALUX_PICKUP_POSTAL_CODE",
  "RABALUX_PICKUP_CONTACT_NAME",
  "RABALUX_PICKUP_CONTACT_PHONE",
  "RABALUX_PICKUP_CONTACT_EMAIL",
] as const;

const X_EXPRESS_REQUIRED_FIELDS = [
  "RABALUX_X_EXPRESS_TOWN_ID",
  "RABALUX_X_EXPRESS_LATITUDE",
  "RABALUX_X_EXPRESS_LONGITUDE",
] as const;

export type RabaluxPickupReadiness = {
  ready: boolean;
  missing: string[];
  invalid: string[];
};

/** Validate the complete provider-specific pickup contract without exposing values. */
export function getRabaluxPickupReadiness(
  provider: SmallParcelProvider,
  env: Environment = process.env,
): RabaluxPickupReadiness {
  const requiredFields = provider === "X_EXPRESS"
    ? [...COMMON_REQUIRED_FIELDS, ...X_EXPRESS_REQUIRED_FIELDS]
    : [...COMMON_REQUIRED_FIELDS];
  const missing = requiredFields.filter((name) => !value(name, env));
  const invalid: string[] = [];

  const postalCode = value("RABALUX_PICKUP_POSTAL_CODE", env);
  if (postalCode && !/^\d{5}$/.test(postalCode)) {
    invalid.push("RABALUX_PICKUP_POSTAL_CODE mora imati pet cifara");
  }

  const houseNumber = value("RABALUX_PICKUP_HOUSE_NUMBER", env);
  if (provider === "MYGLS" && houseNumber && !/^\d/.test(houseNumber)) {
    invalid.push("RABALUX_PICKUP_HOUSE_NUMBER mora početi cifrom za MyGLS adresnicu");
  }

  if (provider === "X_EXPRESS") {
    validatePositiveInteger("RABALUX_X_EXPRESS_TOWN_ID", env, invalid);
    validateCoordinate("RABALUX_X_EXPRESS_LATITUDE", env, 90, invalid);
    validateCoordinate("RABALUX_X_EXPRESS_LONGITUDE", env, 180, invalid);
  }

  return { ready: missing.length === 0 && invalid.length === 0, missing, invalid };
}

/**
 * Rabalux currently dispatches from one fixed warehouse. Keep that address
 * separate from the merchant/DC courier variables so a dropship label can
 * never silently fall back to our own warehouse.
 */
export function requireRabaluxPickupForProvider(
  provider: SmallParcelProvider,
): RabaluxProviderPickup {
  const readiness = getRabaluxPickupReadiness(provider);
  if (!readiness.ready) {
    const reasons = [
      readiness.missing.length
        ? `nedostaje ${readiness.missing.join(", ")}`
        : null,
      readiness.invalid.length
        ? `neispravno: ${readiness.invalid.join(", ")}`
        : null,
    ].filter(Boolean);
    throw new Error(`Rabalux pickup nije kompletan: ${reasons.join("; ")}.`);
  }

  const snapshot = snapshotFromEnv();
  if (provider === "MYGLS") {
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

  const townId = Number(value("RABALUX_X_EXPRESS_TOWN_ID"));
  const latitude = Number(value("RABALUX_X_EXPRESS_LATITUDE"));
  const longitude = Number(value("RABALUX_X_EXPRESS_LONGITUDE"));
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

function snapshotFromEnv(): RabaluxPickupSnapshot {
  return {
    name: value("RABALUX_PICKUP_NAME"),
    street: value("RABALUX_PICKUP_STREET"),
    houseNumber: value("RABALUX_PICKUP_HOUSE_NUMBER"),
    houseNumberInfo: value("RABALUX_PICKUP_HOUSE_NUMBER_INFO"),
    city: value("RABALUX_PICKUP_CITY"),
    postalCode: value("RABALUX_PICKUP_POSTAL_CODE"),
    country: value("RABALUX_PICKUP_COUNTRY") || "RS",
    contactName: value("RABALUX_PICKUP_CONTACT_NAME"),
    contactPhone: value("RABALUX_PICKUP_CONTACT_PHONE"),
    contactEmail: value("RABALUX_PICKUP_CONTACT_EMAIL"),
  };
}

function validatePositiveInteger(
  name: string,
  env: Environment,
  invalid: string[],
) {
  const current = value(name, env);
  if (current && (!Number.isInteger(Number(current)) || Number(current) <= 0)) {
    invalid.push(`${name} mora biti pozitivan ceo broj`);
  }
}

function validateCoordinate(
  name: string,
  env: Environment,
  max: number,
  invalid: string[],
) {
  const current = value(name, env);
  const parsed = Number(current);
  if (current && (!Number.isFinite(parsed) || Math.abs(parsed) > max)) {
    invalid.push(`${name} nije validna koordinata`);
  }
}

function value(name: string, env: Environment = process.env) {
  const current = env[name]?.trim() ?? "";
  return current &&
    !current.startsWith("GET_FROM_") &&
    !current.includes("CHANGE_ME") &&
    !current.toLowerCase().includes("placeholder")
    ? current
    : "";
}
