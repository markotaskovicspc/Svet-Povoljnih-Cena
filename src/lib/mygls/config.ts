import "server-only";

import { createHash } from "node:crypto";
import { isProviderAccepted } from "@/lib/provider-acceptance";

export const MYGLS_PROVIDER = "MYGLS";
export const MYGLS_TEST_BASE_URL = "https://api.test.mygls.rs";
export const MYGLS_PROD_BASE_URL = "https://api.mygls.rs";

export type SmallParcelProvider = "X_EXPRESS" | "MYGLS";

export class MyGlsConfigError extends Error {}
export class MyGlsProviderError extends Error {
  constructor(
    message: string,
    public readonly providerCode?: string,
    public readonly raw?: unknown,
  ) {
    super(message);
  }
}

export interface MyGlsPickupAddress {
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
}

export interface MyGlsConfig {
  enabled: boolean;
  autoCreate: boolean;
  env: "test" | "production";
  baseUrl: string;
  username: string;
  password: string;
  clientNumber: number | null;
  senderIdentityCardNumber: string;
  senderIdentityType: "PIB" | "ID_CARD";
  webshopEngine: string;
  defaultContent: string;
  typeOfPrinter: string;
  labelBucket: string;
  statusCronSecret: string;
  codCardEnabled: boolean;
  contactServiceEnabled: boolean;
  flexDeliveryServiceEnabled: boolean;
  pickup: MyGlsPickupAddress;
}

function trim(value: string | undefined) {
  return value?.trim() ?? "";
}

function bool(value: string | undefined, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function int(value: string | undefined) {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function getSmallParcelProvider(): SmallParcelProvider {
  const value = trim(process.env.COURIER_SMALL_PROVIDER).toUpperCase();
  return value === MYGLS_PROVIDER ? "MYGLS" : "X_EXPRESS";
}

export function getMyGlsConfig(): MyGlsConfig {
  const env = trim(process.env.MYGLS_ENV).toLowerCase() === "production"
    ? "production"
    : "test";
  const baseUrl =
    trim(process.env.MYGLS_BASE_URL).replace(/\/+$/, "") ||
    (env === "production" ? MYGLS_PROD_BASE_URL : MYGLS_TEST_BASE_URL);

  return {
    enabled:
      bool(process.env.MYGLS_ENABLED) &&
      (env === "test" || isProviderAccepted("MYGLS_PRODUCTION_ACCEPTED")),
    autoCreate: bool(process.env.MYGLS_AUTO_CREATE),
    env,
    baseUrl,
    username: trim(process.env.MYGLS_USERNAME),
    password: trim(process.env.MYGLS_PASSWORD),
    clientNumber: int(process.env.MYGLS_CLIENT_NUMBER),
    senderIdentityCardNumber: trim(process.env.MYGLS_SENDER_IDENTITY_CARD_NUMBER),
    senderIdentityType:
      trim(process.env.MYGLS_SENDER_IDENTITY_TYPE).toUpperCase() === "ID_CARD"
        ? "ID_CARD"
        : "PIB",
    webshopEngine: trim(process.env.MYGLS_WEBSHOP_ENGINE) || "Svet povoljnih cena",
    defaultContent: trim(process.env.MYGLS_DEFAULT_CONTENT) || "Webshop order",
    typeOfPrinter: trim(process.env.MYGLS_TYPE_OF_PRINTER) || "A4_2x2",
    labelBucket: trim(process.env.MYGLS_LABEL_BUCKET) || "shipment-labels",
    statusCronSecret: trim(process.env.MYGLS_STATUS_CRON_SECRET),
    codCardEnabled: bool(process.env.MYGLS_COD_CARD_ENABLED),
    contactServiceEnabled: bool(process.env.MYGLS_CONTACT_SERVICE_ENABLED),
    flexDeliveryServiceEnabled: bool(process.env.MYGLS_FLEX_DELIVERY_SERVICE_ENABLED),
    pickup: {
      name: trim(process.env.MYGLS_PICKUP_NAME),
      street: trim(process.env.MYGLS_PICKUP_STREET),
      houseNumber: trim(process.env.MYGLS_PICKUP_HOUSE_NUMBER),
      houseNumberInfo: trim(process.env.MYGLS_PICKUP_HOUSE_NUMBER_INFO),
      city: trim(process.env.MYGLS_PICKUP_CITY),
      postalCode: trim(process.env.MYGLS_PICKUP_POSTAL_CODE),
      country: trim(process.env.MYGLS_PICKUP_COUNTRY) || "RS",
      contactName: trim(process.env.MYGLS_PICKUP_CONTACT_NAME),
      contactPhone: trim(process.env.MYGLS_PICKUP_CONTACT_PHONE),
      contactEmail: trim(process.env.MYGLS_PICKUP_CONTACT_EMAIL),
    },
  };
}

export function requireMyGlsEnabled() {
  const cfg = getMyGlsConfig();
  if (!cfg.enabled) {
    throw new MyGlsConfigError("MyGLS integracija nije uključena.");
  }
  if (!cfg.username || !cfg.password || !cfg.clientNumber) {
    throw new MyGlsConfigError(
      "MyGLS konfiguracija nije kompletna. Proverite username, password i client number.",
    );
  }
  if (!cfg.senderIdentityCardNumber) {
    throw new MyGlsConfigError("MYGLS_SENDER_IDENTITY_CARD_NUMBER je obavezan za Srbiju.");
  }
  if (
    cfg.senderIdentityType === "PIB" &&
    !/^\d{9}$/.test(cfg.senderIdentityCardNumber)
  ) {
    throw new MyGlsConfigError(
      "MyGLS identitet tipa PIB mora sadržati tačno 9 cifara.",
    );
  }
  const fiscalTin = trim(process.env.FISCAL_TIN);
  if (
    cfg.senderIdentityType === "PIB" &&
    fiscalTin &&
    cfg.senderIdentityCardNumber !== fiscalTin
  ) {
    throw new MyGlsConfigError(
      "MyGLS PIB pošiljaoca se ne poklapa sa FISCAL_TIN.",
    );
  }
  const requiredPickupFields = [
    "name",
    "street",
    "houseNumber",
    "city",
    "postalCode",
    "country",
    "contactName",
    "contactPhone",
    "contactEmail",
  ] as const;
  const missingPickup = requiredPickupFields.filter((key) => !cfg.pickup[key]);
  if (missingPickup.length) {
    throw new MyGlsConfigError(
      `MyGLS pickup adresa nije kompletna: ${missingPickup.join(", ")}.`,
    );
  }
  if (!/^\d/.test(cfg.pickup.houseNumber)) {
    throw new MyGlsConfigError(
      "MYGLS_PICKUP_HOUSE_NUMBER mora početi cifrom; GLS mora potvrditi numeričku vrednost za adresu 'bb'.",
    );
  }
  return cfg;
}

export function passwordHashBytes(password: string) {
  return Array.from(createHash("sha512").update(password, "utf8").digest());
}

// MyGLS's JSON API is served by an older WCF endpoint that (de)serializes
// DateTime fields using the ASP.NET AJAX format, not ISO 8601 — an ISO string
// like PickupDate makes PrintLabels fail server-side with a deserialization
// error instead of a normal API error.
export function toMyGlsDate(date: Date): string {
  return `/Date(${date.getTime()})/`;
}

export function buildMyGlsUrl(
  cfg: Pick<MyGlsConfig, "baseUrl">,
  serviceName: "ParcelService" | "MasterDataService",
  methodName: string,
) {
  return `${cfg.baseUrl}/${serviceName}.svc/json/${methodName}`;
}

export function myGlsAuthBase(cfg: MyGlsConfig) {
  return {
    Username: cfg.username,
    Password: passwordHashBytes(cfg.password),
    ClientNumberList: cfg.clientNumber ? [cfg.clientNumber] : [],
    WebshopEngine: cfg.webshopEngine,
  };
}

export function redactMyGlsSecrets(input: unknown): unknown {
  if (typeof input === "string") {
    const cfg = getMyGlsConfig();
    return [cfg.username, cfg.password].reduce((acc, secret) => {
      if (!secret) return acc;
      return acc.replaceAll(secret, "[redacted]");
    }, input);
  }
  if (!input || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(redactMyGlsSecrets);
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/password|username|secret|token|identity/i.test(key)) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = redactMyGlsSecrets(value);
    }
  }
  return redacted;
}
