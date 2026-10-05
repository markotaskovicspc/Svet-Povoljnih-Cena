import { describe, expect, it } from "vitest";
import type { MyGlsConfig } from "@/lib/mygls/config";
import {
  buildMyGlsParcelForOrder,
  buildMyGlsParcelsForOrder,
  myGlsArticleContent,
} from "@/lib/mygls/payload";

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
  shipStreet: "Bulevar oslobođenja (10A)",
  shipHouseNumber: "10A",
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
  it("adjusts only outgoing weight once, preserving inputs, COD and dimensions on retries", () => {
    const before = structuredClone(packages);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = buildMyGlsParcelsForOrder({ cfg: config, order, packages });
      expect(result.map(p => p.ParcelPropertyList?.[0]?.Weight)).toEqual([6, 6]);
      expect(result[0].ParcelPropertyList?.[0]).toMatchObject({ Width: 40, Length: 50, Height: 30 });
      expect(result.map(p => p.CODAmount)).toEqual([12000, 0]);
    }
    expect(packages).toEqual(before);
    expect(() => buildMyGlsParcelForOrder({cfg: config, order, packages: [{...packages[0], weightKg: 45}]})).toThrow("MyGLS granica");
  });
  it("keeps the full reshipment identity and parcel number for long order numbers", () => {
    const parcels = buildMyGlsParcelsForOrder({ cfg: config, order: { ...order, number: "SPC-" + "1".repeat(40) }, packages, clientReferenceSuffix: "S123456789012" });
    expect(parcels).toHaveLength(2);
    expect(parcels[0].ClientReference).toMatch(/-S123456789012-P1$/);
    expect(parcels[1].ClientReference).toMatch(/-S123456789012-P2$/);
    expect(parcels.every(p => p.ClientReference.length <= 40)).toBe(true);
  });
  it("prints each article's SKU and EAN on its own label even when package names are stale", () => {
    const items = [
      { id: "item-1", name: "Komjuter sto LOFT", sku: "210027", qty: 1, product: { barcode: "0012345678905" } },
      { id: "item-2", name: "Stolica", sku: "110081", qty: 1, product: { barcode: "8601234567890" } },
    ];
    const parcels = buildMyGlsParcelsForOrder({ cfg: config, order: { ...order, items }, packages: [
      { ...packages[0]!, orderItemId: "item-2", content: "Stari naziv" },
      { ...packages[1]!, orderItemId: "item-1" },
    ] });
    expect(parcels.map((parcel) => parcel.Content)).toEqual([
      "Stolica / Sifra: 110081 / EAN: 8601234567890",
      "Komjuter sto LOFT / Sifra: 210027 / EAN: 0012345678905",
    ]);
    expect(parcels.map((parcel) => parcel.ParcelPropertyList?.[0]?.Content)).toEqual(parcels.map((parcel) => parcel.Content));
    expect(parcels.map((parcel) => parcel.CODAmount)).toEqual([12_000, 0]);
  });

  it("keeps full identifiers and leading zeros when shortening a long article name", () => {
    const content = myGlsArticleContent({ name: "Dugačak naziv ".repeat(30), qty: 1, sku: "001234", product: { barcode: "0012345678905" } });
    expect(content.length).toBeLessThanOrEqual(120);
    expect(content).toMatch(/\.\.\. \/ Sifra: 001234 \/ EAN: 0012345678905$/);
    expect(myGlsArticleContent({ name: "Sto", qty: 1, sku: "0001", product: null })).toBe("Sto / Sifra: 0001");
  });

  it("does not put the complete article barcode on a replacement part", () => {
    const parcel = buildMyGlsParcelForOrder({ cfg: config, order: { ...order, items: [
      { id: "item-1", name: "Stolica", qty: 1, sku: "110081", product: { barcode: "8601234567890" } },
    ] }, packages: [{ ...packages[0]!, content: "Naslon stolice" }], purpose: "RECLAMATION_REPLACEMENT" });
    expect(parcel.Content).toBe("Naslon stolice");
  });
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
      HouseNumber: "10",
      HouseNumberInfo: "(10A)",
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

  it("uses the actual spare-part description on the replacement label", () => {
    const parcel = buildMyGlsParcelForOrder({
      cfg: config,
      order,
      packages: [
        {
          ...packages[0]!,
          content: "ukrasna maska",
        },
      ],
      purpose: "RECLAMATION_REPLACEMENT",
    });

    expect(parcel.Content).toBe("ukrasna maska");
    expect(parcel.ParcelPropertyList?.[0]?.Content).toBe("ukrasna maska");
  });

  it("maps every physical package to one real ParcelProperty and never invents dimensions", () => {
    const parcel = buildMyGlsParcelForOrder({ cfg: config, order, packages });

    expect(parcel.Count).toBe(2);
    expect(parcel.PickupAddress).toMatchObject({
      Name: "Svet povoljnih cena",
      Street: "Evropska",
      HouseNumber: "1",
      HouseNumberInfo: "bb",
      City: "Stara Pazova",
      ContactEmail: "dc@example.invalid",
    });
    expect(parcel.PickupAddress).not.toHaveProperty("ContactName");
    expect(parcel.PickupAddress).not.toHaveProperty("ContactPhone");
    expect(parcel.ParcelPropertyList).toEqual([
      {
        Content: "Stolica",
        PackageType: 2,
        Weight: 6,
        Height: 30,
        Width: 40,
        Length: 50,
      },
      {
        Content: "Stolica",
        PackageType: 2,
        Weight: 6,
        Height: 30,
        Width: 40,
        Length: 50,
      },
    ]);
    expect(parcel.ServiceList).toBeUndefined();
  });

  it("includes the operational contact when the pickup is at a supplier warehouse", () => {
    const parcel = buildMyGlsParcelForOrder({
      cfg: config,
      order,
      packages,
      pickupContactOnLabel: true,
    });

    expect(parcel.PickupAddress).toMatchObject({
      Name: "Svet povoljnih cena",
      ContactName: "DC magacin",
      ContactPhone: "+381641234567",
      ContactEmail: "dc@example.invalid",
    });
  });

  it("rounds decimal dimensions upwards to the Int32 values required by MyGLS", () => {
    const parcel = buildMyGlsParcelForOrder({
      cfg: config,
      order,
      packages: [
        {
          ...packages[0]!,
          weightKg: 7.5,
          heightCm: 6.5,
          widthCm: 88.1,
          depthCm: 44,
        },
      ],
    });

    expect(parcel.ParcelPropertyList).toEqual([
      expect.objectContaining({
        Weight: 6,
        Height: 7,
        Width: 89,
        Length: 44,
      }),
    ]);
  });

  it("keeps the exact product name on each physical-package property", () => {
    const contents = ["Ergo Lux", "Urban Seat", "Clean Box"];
    const parcel = buildMyGlsParcelForOrder({
      cfg: config,
      order: {
        ...order,
        items: contents.map((name) => ({ name, qty: 1 })),
      },
      packages: contents.map((content, index) => ({
        ...packages[0]!,
        packageNo: index + 1,
        orderItemId: `item-${index + 1}`,
        content,
      })),
    });

    expect(parcel.ParcelPropertyList?.map((pkg) => pkg.Content)).toEqual(
      contents,
    );
  });

  it("creates separate provider labels with one exact product name per order item", () => {
    const labelParcels = buildMyGlsParcelsForOrder({
      cfg: config,
      order: {
        ...order,
        items: [
          { name: "Trpezarijski sto HOME STYLE", qty: 1 },
          { name: "Trpezarijski set URBAN", qty: 1 },
        ],
      },
      packages: [
        {
          ...packages[0]!,
          packageNo: 1,
          orderItemId: "item-home-style",
          content: "Trpezarijski sto HOME STYLE",
        },
        {
          ...packages[1]!,
          packageNo: 2,
          orderItemId: "item-urban",
          content: "Trpezarijski set URBAN",
        },
      ],
    });

    expect(labelParcels).toHaveLength(2);
    expect(labelParcels.map((parcel) => parcel.Content)).toEqual([
      "Trpezarijski sto HOME STYLE",
      "Trpezarijski set URBAN",
    ]);
    expect(labelParcels.map((parcel) => parcel.Count)).toEqual([1, 1]);
    expect(
      labelParcels.map((parcel) =>
        parcel.ParcelPropertyList?.map((property) => property.Content),
      ),
    ).toEqual([["Trpezarijski sto HOME STYLE"], ["Trpezarijski set URBAN"]]);
    expect(labelParcels.map((parcel) => parcel.CODAmount)).toEqual([12_000, 0]);
    expect(labelParcels.map((parcel) => parcel.CODReference)).toEqual([
      "SPC-2026-000001",
      undefined,
    ]);
  });

  it("makes every sold unit separately cancellable even for the same item", () => {
    const labelParcels = buildMyGlsParcelsForOrder({
      cfg: config,
      order,
      packages,
    });

    expect(labelParcels).toHaveLength(2);
    expect(labelParcels.map((parcel) => parcel.Count)).toEqual([1, 1]);
    expect(labelParcels.map((parcel) => parcel.ClientReference)).toEqual([
      "SPC-2026-000001-P1",
      "SPC-2026-000001-P2",
    ]);
    expect(labelParcels.map((parcel) => parcel.CODAmount)).toEqual([12_000, 0]);
    expect(labelParcels.map((parcel) => parcel.Content)).toEqual([
      "Stolica",
      "Stolica",
    ]);
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

  it("does not add COD to the second half of a split order", () => {
    const parcel = buildMyGlsParcelForOrder({
      cfg: config,
      order: { ...order, total: 0 },
      packages,
    });

    expect(parcel.CODAmount).toBe(0);
    expect(parcel.CODReference).toBeUndefined();
  });
});

it("sends one consolidated Pompea parcel with the whole COD and all article contents", () => {
  const packedItems = ["i", "j"].map((orderItemId, i) => ({ orderItemId, quantity: 2 + i, sku: `SKU${i}`, name: `POMPEA ${i}`, barcode: null, categoryName: null, color1: null, color2: null, unitValue: 100 }));
  const parcels = buildMyGlsParcelsForOrder({ cfg: config, order: { ...order, items: packedItems.map(item => ({ id: item.orderItemId, name: item.name, qty: item.quantity })) }, packages: [{ ...packages[0], orderItemId: "i", packedItems, packedQuantity: 5, content: "2 × POMPEA 0; 3 × POMPEA 1" }] });
  expect(parcels).toHaveLength(1);
  expect(parcels[0]).toMatchObject({ Count: 1, CODAmount: 12000, Content: "2 × POMPEA 0; 3 × POMPEA 1" });
});

describe("GLS customer pickup service", () => {
  it("requests PRS on every physical return parcel, with customer home pickup and no outbound services or COD", () => {
    const parcels = buildMyGlsParcelsForOrder({
      cfg: { ...config, contactServiceEnabled: true, flexDeliveryServiceEnabled: true },
      order: { ...order, glsDeliveryPointId: "shop-1", glsDeliveryPointAddress: "Prodavnica 99", glsDeliveryPointCity: "Beograd", glsDeliveryPointPostalCode: "11000" },
      packages, purpose: "RECLAMATION_RETURN",
    });
    expect(parcels).toHaveLength(2);
    for (const parcel of parcels) {
      expect(parcel.ServiceList).toEqual([{ Code: "PRS" }]);
      expect(parcel.PickupAddress).toMatchObject({ Street: "Bulevar oslobođenja", HouseNumber: "10", City: "Novi Sad", ContactPhone: "+381642223344" });
      expect(parcel.CODAmount).toBe(0);
      expect(parcel.FinalDeliveryAddress).toBeUndefined();
    }
  });
  it("blocks a pickup with a missing customer telephone", () => {
    expect(() => buildMyGlsParcelForOrder({ cfg: config, order: { ...order, shipPhone: "" }, packages, purpose: "RECLAMATION_RETURN" })).toThrow(/telefon kupca/);
  });
  it("does not add PRS to normal deliveries or outbound replacements", () => {
    for (const purpose of ["ORDER_DELIVERY", "RECLAMATION_REPLACEMENT"] as const) {
      expect(buildMyGlsParcelForOrder({ cfg: config, order, packages, purpose }).ServiceList).toBeUndefined();
    }
  });
});


describe("MyGLS postal code preflight", () => {
  it.each(["", "1100", "110000", "11000 Beograd", "GET_FROM_POSTAL_CODE"])(
    "rejects invalid domestic recipient postal code %j with order identity",
    (shipPostalCode) => {
      expect(() => buildMyGlsParcelsForOrder({cfg: config, order: {...order, shipPostalCode}, packages}))
        .toThrow(`Adresa primaoca za porudžbinu ${order.number}: neispravan poštanski broj`);
    },
  );
  it("trims recipient and pickup postal codes without changing their inputs", () => {
    const input = {...order, shipPostalCode: " 21000 "};
    const cfg = {...config, pickup: {...config.pickup, postalCode: " 22300 "}};
    const [parcel] = buildMyGlsParcelsForOrder({cfg, order: input, packages});
    expect(parcel.DeliveryAddress.ZipCode).toBe("21000");
    expect(parcel.PickupAddress.ZipCode).toBe("22300");
    expect(input.shipPostalCode).toBe(" 21000 ");
  });
  it("validates the selected delivery point instead of the customer's home zip", () => {
    expect(() => buildMyGlsParcelsForOrder({cfg: config, order: {...order, glsDeliveryPointPostalCode: ""}, packages}))
      .toThrow("neispravan poštanski broj");
  });
  it("preserves foreign postcode formats", () => {
    const [parcel] = buildMyGlsParcelsForOrder({cfg: config, order: {...order, shipCountry: "GB", shipPostalCode: "SW1A 1AA"}, packages});
    expect(parcel.DeliveryAddress.ZipCode).toBe("SW1A 1AA");
  });
  it("rejects invalid warehouse postcode before booking a return", () => {
    expect(() => buildMyGlsParcelsForOrder({cfg: {...config, pickup: {...config.pickup, postalCode: ""}}, order, packages, purpose: "RECLAMATION_RETURN"}))
      .toThrow("Adresa magacina: neispravan poštanski broj");
  });
});
