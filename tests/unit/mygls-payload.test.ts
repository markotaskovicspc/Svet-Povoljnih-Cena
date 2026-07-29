import { describe, expect, it } from "vitest";
import type { MyGlsConfig } from "@/lib/mygls/config";
import { buildMyGlsParcelForOrder } from "@/lib/mygls/payload";

const config: MyGlsConfig = {
  enabled: true,
  autoCreate: false,
  env: "test",
  baseUrl: "https://mygls.example.invalid",
  username: "qa",
  password: "secret",
  clientNumber: 123,
  senderIdentityCardNumber: "QA-ID",
  webshopEngine: "QA",
  defaultContent: "Webshop porudžbina",
  typeOfPrinter: "A4_2x2",
  labelBucket: "shipment-labels",
  statusCronSecret: "",
  pickup: {
    name: "Svet povoljnih cena",
    street: "Vojvođanska 401",
    city: "Surčin",
    postalCode: "11271",
    country: "RS",
    contactName: "DC magacin",
    contactPhone: "+381641234567",
    contactEmail: "dc@example.invalid",
  },
};

const order = {
  id: "order-1",
  number: "SPC-2026-000001",
  total: 12_000,
  paymentMethod: "POUZECE_GOTOVINA" as const,
  shipFirstName: "Petar",
  shipLastName: "Petrović",
  shipPhone: "0642223344",
  shipStreet: "Bulevar oslobođenja 10A",
  shipCity: "Novi Sad",
  shipPostalCode: "21000",
  shipCountry: "RS",
  shipCompanyName: null,
  guestEmail: "petar@example.invalid",
  items: [{ name: "Stolica", qty: 2 }],
};

describe("MyGLS reclamation payload", () => {
  it("reverses pickup and delivery and suppresses COD for a return", () => {
    const parcel = buildMyGlsParcelForOrder({
      cfg: config,
      order,
      purpose: "RECLAMATION_RETURN",
      pickupDate: new Date("2026-07-30T08:00:00.000Z"),
    });

    expect(parcel.ClientReference).toBe("SPC-2026-000001-POVRAT");
    expect(parcel.CODAmount).toBe(0);
    expect(parcel.CODReference).toBeUndefined();
    expect(parcel.PickupAddress).toMatchObject({
      Name: "Petar Petrović",
      Street: "Bulevar oslobođenja",
      HouseNumber: "10A",
      City: "Novi Sad",
    });
    expect(parcel.DeliveryAddress).toMatchObject({
      Name: "Svet povoljnih cena",
      Street: "Vojvođanska",
      HouseNumber: "401",
      City: "Surčin",
    });
  });

  it("keeps replacement outbound but suppresses COD", () => {
    const parcel = buildMyGlsParcelForOrder({
      cfg: config,
      order,
      purpose: "RECLAMATION_REPLACEMENT",
    });

    expect(parcel.ClientReference).toBe("SPC-2026-000001-ZAMENA");
    expect(parcel.CODAmount).toBe(0);
    expect(parcel.PickupAddress.City).toBe("Surčin");
    expect(parcel.DeliveryAddress.City).toBe("Novi Sad");
  });
});
