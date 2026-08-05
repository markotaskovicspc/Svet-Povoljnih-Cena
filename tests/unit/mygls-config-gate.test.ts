import { afterEach, describe, expect, it } from "vitest";
import { getMyGlsConfig, requireMyGlsEnabled } from "@/lib/mygls/config";

const names = [
  "MYGLS_ENABLED",
  "MYGLS_ENV",
  "MYGLS_PRODUCTION_ACCEPTED",
  "MYGLS_AUTO_CREATE",
  "MYGLS_USERNAME",
  "MYGLS_PASSWORD",
  "MYGLS_CLIENT_NUMBER",
  "MYGLS_SENDER_IDENTITY_CARD_NUMBER",
  "MYGLS_SENDER_IDENTITY_TYPE",
  "MYGLS_PICKUP_NAME",
  "MYGLS_PICKUP_STREET",
  "MYGLS_PICKUP_HOUSE_NUMBER",
  "MYGLS_PICKUP_HOUSE_NUMBER_INFO",
  "MYGLS_PICKUP_CITY",
  "MYGLS_PICKUP_POSTAL_CODE",
  "MYGLS_PICKUP_COUNTRY",
  "MYGLS_PICKUP_CONTACT_NAME",
  "MYGLS_PICKUP_CONTACT_PHONE",
  "MYGLS_PICKUP_CONTACT_EMAIL",
  "FISCAL_TIN",
] as const;
const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of names) {
    const value = original[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("MyGLS production safety gates", () => {
  it("cannot enable the production client while acceptance and auto-create stay false", () => {
    process.env.MYGLS_ENABLED = "true";
    process.env.MYGLS_ENV = "production";
    process.env.MYGLS_PRODUCTION_ACCEPTED = "false";
    process.env.MYGLS_AUTO_CREATE = "false";

    const config = getMyGlsConfig();
    expect(config.enabled).toBe(false);
    expect(config.autoCreate).toBe(false);
    expect(() => requireMyGlsEnabled()).toThrow("MyGLS integracija nije uključena");
  });

  it("refuses a non-numeric pickup house number even after the production gate is accepted", () => {
    Object.assign(process.env, {
      MYGLS_ENABLED: "true",
      MYGLS_ENV: "production",
      MYGLS_PRODUCTION_ACCEPTED: "true",
      MYGLS_AUTO_CREATE: "false",
      MYGLS_USERNAME: "qa@example.invalid",
      MYGLS_PASSWORD: "secret",
      MYGLS_CLIENT_NUMBER: "123",
      MYGLS_SENDER_IDENTITY_CARD_NUMBER: "123456789",
      MYGLS_SENDER_IDENTITY_TYPE: "PIB",
      FISCAL_TIN: "123456789",
      MYGLS_PICKUP_NAME: "DC",
      MYGLS_PICKUP_STREET: "Severna transverzala",
      MYGLS_PICKUP_HOUSE_NUMBER: "bb",
      MYGLS_PICKUP_CITY: "Šabac",
      MYGLS_PICKUP_POSTAL_CODE: "15000",
      MYGLS_PICKUP_COUNTRY: "RS",
      MYGLS_PICKUP_CONTACT_NAME: "Marko Tasković",
      MYGLS_PICKUP_CONTACT_PHONE: "0621112222",
      MYGLS_PICKUP_CONTACT_EMAIL: "office@example.invalid",
    });

    expect(() => requireMyGlsEnabled()).toThrow("mora početi cifrom");
  });

  it("accepts the GLS-confirmed numeric mapping for the Evropska bb pickup address", () => {
    Object.assign(process.env, {
      MYGLS_ENABLED: "true",
      MYGLS_ENV: "production",
      MYGLS_PRODUCTION_ACCEPTED: "true",
      MYGLS_AUTO_CREATE: "false",
      MYGLS_USERNAME: "qa@example.invalid",
      MYGLS_PASSWORD: "secret",
      MYGLS_CLIENT_NUMBER: "123",
      MYGLS_SENDER_IDENTITY_CARD_NUMBER: "123456789",
      MYGLS_SENDER_IDENTITY_TYPE: "PIB",
      FISCAL_TIN: "123456789",
      MYGLS_PICKUP_NAME: "Svet povoljnih cena",
      MYGLS_PICKUP_STREET: "Evropska",
      MYGLS_PICKUP_HOUSE_NUMBER: "1",
      MYGLS_PICKUP_HOUSE_NUMBER_INFO: "bb",
      MYGLS_PICKUP_CITY: "Stara Pazova",
      MYGLS_PICKUP_POSTAL_CODE: "22300",
      MYGLS_PICKUP_COUNTRY: "RS",
      MYGLS_PICKUP_CONTACT_NAME: "Marko Tasković",
      MYGLS_PICKUP_CONTACT_PHONE: "0621112222",
      MYGLS_PICKUP_CONTACT_EMAIL: "office@example.invalid",
    });

    expect(requireMyGlsEnabled().pickup).toMatchObject({
      street: "Evropska",
      houseNumber: "1",
      houseNumberInfo: "bb",
      city: "Stara Pazova",
      postalCode: "22300",
    });
  });
});
