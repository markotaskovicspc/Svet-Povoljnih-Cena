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
  senderIdentityCardNumber: "123456789",
  senderIdentityType: "PIB",
  webshopEngine: "QA",
  defaultContent: "Webshop porudžbina",
  typeOfPrinter: "A4_2x2",
  labelBucket: "shipment-labels",
  statusCronSecret: "",
  codCardEnabled: false,
  contactServiceEnabled: false,
  flexDeliveryServiceEnabled: false,
  pickup: {
    name: "Svet povoljnih cena",
    street: "Evropska",
    houseNumber: "1",
    houseNumberInfo: "bb",
    city: "Stara Pazova",
    postalCode: "22300",
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

const packages = [
  {
    packageNo: 1,
    orderItemId: "item-1",
    content: "Stolica",
    weightKg: 7.5,
    widthCm: 40,
    depthCm: 50,
    heightCm: 30,
  },
  {
    packageNo: 2,
    orderItemId: "item-1",
    content: "Stolica",
    weightKg: 7.5,
    widthCm: 40,
    depthCm: 50,
    heightCm: 30,
  },
];

describe("MyGLS reclamation payload", () => {
  it("reverses pickup and delivery and suppresses COD for a return", () => {
    const parcel = buildMyGlsParcelForOrder({
      cfg: config,
      order,
      packages,
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
      Street: "Evropska",
      HouseNumber: "1",
      HouseNumberInfo: "bb",
      City: "Stara Pazova",
    });
  });

  it("keeps replacement outbound but suppresses COD", () => {
    const parcel = buildMyGlsParcelForOrder({
      cfg: config,
      order,
      packages,
      purpose: "RECLAMATION_REPLACEMENT",
    });

    expect(parcel.ClientReference).toBe("SPC-2026-000001-ZAMENA");
    expect(parcel.CODAmount).toBe(0);
    expect(parcel.PickupAddress.City).toBe("Stara Pazova");
    expect(parcel.DeliveryAddress.City).toBe("Novi Sad");
  });

  it("collects COD on only one courier shipment of a mixed order", () => {
    const parcel = buildMyGlsParcelForOrder({
      cfg: config,
      order,
      packages,
      collectCashOnDelivery: false,
    });

    expect(parcel.CODAmount).toBe(0);
    expect(parcel.CODReference).toBeUndefined();
  });

  it("maps every physical package to one real ParcelProperty and never invents dimensions", () => {
    const parcel = buildMyGlsParcelForOrder({ cfg: config, order, packages });

    expect(parcel.Count).toBe(2);
    expect(parcel.ParcelPropertyList).toEqual([
      {
        Content: "Stolica",
        PackageType: 2,
        Weight: 7.5,
        Height: 30,
        Width: 40,
        Length: 50,
      },
      {
        Content: "Stolica",
        PackageType: 2,
        Weight: 7.5,
        Height: 30,
        Width: 40,
        Length: 50,
      },
    ]);
    expect(parcel.ServiceList).toBeUndefined();
  });

  it("blocks incomplete measurements before any provider call", () => {
    expect(() =>
      buildMyGlsParcelForOrder({
        cfg: config,
        order,
        packages: [{ ...packages[0], weightKg: null }],
      }),
    ).toThrow("Paket 1 nema kompletne stvarne mere: težina");
  });

  it("keeps card COD and optional notification services behind explicit flags", () => {
    expect(() =>
      buildMyGlsParcelForOrder({
        cfg: config,
        order: { ...order, paymentMethod: "POUZECE_KARTICA" as const },
        packages,
      }),
    ).toThrow("MYGLS_COD_CARD_ENABLED=false");

    const parcel = buildMyGlsParcelForOrder({
      cfg: {
        ...config,
        codCardEnabled: true,
        contactServiceEnabled: true,
        flexDeliveryServiceEnabled: true,
      },
      order: { ...order, paymentMethod: "POUZECE_KARTICA" as const },
      packages,
    });
    expect(parcel.CODAmount).toBe(12_000);
    expect(parcel.ServiceList?.map((service) => service.Code)).toEqual([
      "CS1",
      "FDS",
    ]);
  });
});
