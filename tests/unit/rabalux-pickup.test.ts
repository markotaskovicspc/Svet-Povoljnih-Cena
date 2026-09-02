import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRabaluxPickupReadiness,
  requireRabaluxPickupForProvider,
} from "@/lib/rabalux/pickup";

const common = {
  RABALUX_PICKUP_NAME: "Rabalux Srbija",
  RABALUX_PICKUP_STREET: "Industrijska",
  RABALUX_PICKUP_HOUSE_NUMBER: "12",
  RABALUX_PICKUP_CITY: "Beograd",
  RABALUX_PICKUP_POSTAL_CODE: "11000",
  RABALUX_PICKUP_CONTACT_NAME: "Magacin",
  RABALUX_PICKUP_CONTACT_PHONE: "+38111111111",
  RABALUX_PICKUP_CONTACT_EMAIL: "magacin@example.test",
};

function stub(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

afterEach(() => vi.unstubAllEnvs());

describe("Rabalux fixed dropship pickup", () => {
  it("builds a MyGLS sender without falling back to the DC", () => {
    stub(common);
    const result = requireRabaluxPickupForProvider("MYGLS");
    expect(result.provider).toBe("MYGLS");
    expect(result.pickup).toMatchObject({
      name: "Rabalux Srbija",
      street: "Industrijska",
      houseNumber: "12",
    });
  });

  it("requires X Express town and coordinates", () => {
    stub({
      ...common,
      RABALUX_X_EXPRESS_TOWN_ID: "42",
      RABALUX_X_EXPRESS_LATITUDE: "44.8125",
      RABALUX_X_EXPRESS_LONGITUDE: "20.4612",
    });
    const result = requireRabaluxPickupForProvider("X_EXPRESS");
    expect(result.provider).toBe("X_EXPRESS");
    expect(result.pickup).toMatchObject({ townId: 42, latitude: 44.8125 });
  });

  it("treats deployment placeholders as missing", () => {
    stub({ ...common, RABALUX_PICKUP_NAME: "GET_FROM_VERCEL" });
    expect(() => requireRabaluxPickupForProvider("MYGLS")).toThrow(
      /RABALUX_PICKUP_NAME/,
    );
  });

  it("reports all missing values at once, including active X Express fields", () => {
    const readiness = getRabaluxPickupReadiness("X_EXPRESS", {
      RABALUX_PICKUP_STREET: "Industrijska",
      RABALUX_PICKUP_NAME: "GET_FROM_VERCEL",
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual([
      "RABALUX_PICKUP_NAME",
      "RABALUX_PICKUP_HOUSE_NUMBER",
      "RABALUX_PICKUP_CITY",
      "RABALUX_PICKUP_POSTAL_CODE",
      "RABALUX_PICKUP_CONTACT_NAME",
      "RABALUX_PICKUP_CONTACT_PHONE",
      "RABALUX_PICKUP_CONTACT_EMAIL",
      "RABALUX_X_EXPRESS_TOWN_ID",
      "RABALUX_X_EXPRESS_LATITUDE",
      "RABALUX_X_EXPRESS_LONGITUDE",
    ]);
  });

  it("reports every invalid provider value in one error", () => {
    stub({
      ...common,
      RABALUX_PICKUP_POSTAL_CODE: "1100",
      RABALUX_X_EXPRESS_TOWN_ID: "0",
      RABALUX_X_EXPRESS_LATITUDE: "91",
      RABALUX_X_EXPRESS_LONGITUDE: "not-a-coordinate",
    });

    expect(() => requireRabaluxPickupForProvider("X_EXPRESS")).toThrow(
      /POSTAL_CODE.*TOWN_ID.*LATITUDE.*LONGITUDE/,
    );
  });
});
