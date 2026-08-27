import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeXExpressRouteCode,
  XExpressClient,
} from "@/lib/x-express/client";
import {
  getXExpressConfig,
  requireXExpressShipmentConfig,
  type XExpressConfig,
} from "@/lib/x-express/config";
import { formatXExpressTrackingCode } from "@/lib/x-express/code";
import {
  buildXExpressAddressCheckPayload,
  buildXExpressCreateOrderPayload,
  normalizeXExpressPhone,
  normalizeXExpressStreetNumber,
  splitXExpressStreet,
} from "@/lib/x-express/payload";
import {
  buildXExpressLabelData,
  encodeXExpressCode128,
  renderXExpressBatchLabelsHtml,
  renderXExpressLabelsHtml,
} from "@/lib/x-express/labels";
import {
  isXExpressWebhookContractValid,
  parseXExpressWebhookBatch,
  verifyXExpressWebhookHeaders,
} from "@/lib/x-express/webhook";
import { inferXExpressShipmentStatus } from "@/lib/x-express/status";
import { isXExpressAnnouncementPaymentReady } from "@/lib/x-express/payment";

const config: XExpressConfig = {
  enabled: true,
  autoCreate: false,
  env: "test",
  baseUrl: "https://xexpress.example.invalid",
  apiUser: "api-user",
  apiKey: "api-key",
  webhookApiKey: "webhook-key",
  webhookSecret: "legacy-webhook-key",
  contractCode: "U000328",
  codePrefix: "AAA",
  codeRangeStart: 850300001,
  codeRangeEnd: 850599999,
  statusCronSecret: "",
  servicePayerId: 1,
  serviceTypeId: 1,
  defaultContent: "Webshop porudžbina",
  pickup: {
    name: "Svet povoljnih cena",
    townId: 703907,
    streetName: "Vojvođanska",
    streetNumber: "401",
    latitude: 44.8001239,
    longitude: 20.3253489,
    description: "DC magacin",
    contactName: "DC magacin",
    contactPhone: "+381 64 123 4567",
    contactEmail: "dc@example.invalid",
  },
  cod: {
    name: "Svet povoljnih cena",
    account: "265-3310310005375-34",
    address: "Vojvođanska 401, Surčin",
  },
  paths: {
    municipalities: "/api/data/municipalities",
    towns: "/api/data/towns",
    streets: "/api/data/streets",
    statuses: "/api/data/statuses",
    checkAddress: "/api/order/check-address",
    createOrder: "/api/order/add",
    status: "",
  },
};

const order = {
  total: 12_345.67,
  paymentMethod: "POUZECE_GOTOVINA" as const,
  shipFirstName: "Petar",
  shipLastName: "Petrović",
  shipPhone: "064/222-33-44",
  shipStreet: "Bulevar oslobođenja 10A",
  shipCompanyName: null,
  notes: "Pozvati pre isporuke",
  guestEmail: "petar@example.invalid",
  user: null,
  items: [
    {
      name: "Stolica",
      qty: 5,
      product: {
        packQty: 2,
        packGrossWeightKg: new Prisma.Decimal("1.2"),
        grossWeightKg: null,
        weightKg: null,
      },
    },
  ],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("X Express official API contract", () => {
  it("enables the provider test account without opening the production gate", () => {
    vi.stubEnv("X_EXPRESS_ENABLED", "true");
    vi.stubEnv("X_EXPRESS_ENV", "test");
    vi.stubEnv("X_EXPRESS_PRODUCTION_ACCEPTED", "false");
    expect(getXExpressConfig().enabled).toBe(true);

    vi.stubEnv("X_EXPRESS_ENV", "production");
    expect(getXExpressConfig().enabled).toBe(false);
    vi.stubEnv("X_EXPRESS_PRODUCTION_ACCEPTED", "true");
    expect(getXExpressConfig().enabled).toBe(true);
  });

  it("treats GET_FROM placeholders as missing", () => {
    vi.stubEnv("X_EXPRESS_API_KEY", "GET_FROM_X_EXPRESS");
    expect(getXExpressConfig().apiKey).toBe("");
  });

  it("accepts the confirmed first code and normalizes the legacy earlier start", () => {
    const env = {
      X_EXPRESS_ENABLED: "true",
      X_EXPRESS_ENV: "test",
      X_EXPRESS_BASE_URL: "https://portal.pm.xexpress.rs",
      X_EXPRESS_API_USER: "api-user",
      X_EXPRESS_API_KEY: "api-key",
      X_EXPRESS_CONTRACT_CODE: "U000328",
      X_EXPRESS_CODE_PREFIX: "AAA",
      X_EXPRESS_CODE_RANGE_START: "850300001",
      X_EXPRESS_CODE_RANGE_END: "850599999",
      X_EXPRESS_CREATE_ORDER_PATH: "/api/order/add",
      X_EXPRESS_PICKUP_NAME: "Svet povoljnih cena",
      X_EXPRESS_PICKUP_TOWN_ID: "746606",
      X_EXPRESS_PICKUP_STREET_NAME: "Severna transferzala",
      X_EXPRESS_PICKUP_STREET_NUMBER: "bb",
      X_EXPRESS_PICKUP_LATITUDE: "44.7735236",
      X_EXPRESS_PICKUP_LONGITUDE: "19.6805083",
      X_EXPRESS_PICKUP_CONTACT_NAME: "DC magacin",
      X_EXPRESS_PICKUP_CONTACT_PHONE: "381641234567",
    };
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);

    expect(requireXExpressShipmentConfig().codeRangeStart).toBe(850300001);

    vi.stubEnv("X_EXPRESS_CODE_RANGE_START", "850300000");
    expect(requireXExpressShipmentConfig().codeRangeStart).toBe(850300001);
  });

  it("builds the exact PascalCase address-check request", () => {
    expect(
      buildXExpressAddressCheckPayload({
        recipientName: "Petar Petrović",
        townId: 791113,
        street: "Pogrešan naziv 10A",
        officialStreetName: "Bulevar oslobođenja",
      }),
    ).toEqual({
      Name: "Petar Petrović",
      TownId: 791113,
      StreetName: "Bulevar oslobođenja",
      StreetNumber: "10A",
      Description: null,
    });
  });

  it("builds pickup, delivery, return, COD and one unique code per package", () => {
    const payload = buildXExpressCreateOrderPayload({
      cfg: config,
      reference: "758bb513-499d-4ab1-8697-5e747602f222",
      trackingCodes: ["AAA0850300001", "AAA0850300002"],
      order,
      townId: 791113,
      officialStreetName: "Bulevar oslobođenja",
    });

    expect(Object.keys(payload)).toEqual([
      "ContractCode",
      "Reference",
      "Sender",
      "Recipient",
      "ServicePayerId",
      "TypeId",
      "Content",
      "Waypoints",
      "Options",
      "Packages",
    ]);
    expect(payload.Reference).toBe("758bb513-499d-4ab1-8697-5e747602f222");
    expect(payload.Sender.Phone).toBe("381641234567");
    expect(payload.Recipient.Phone).toBe("381642223344");
    expect(payload.Waypoints.map((item) => item.WaypointType)).toEqual([
      "PICKUP",
      "DELIVERY",
      "RETURN",
    ]);
    expect(payload.Waypoints[0]?.Address).toMatchObject({
      TownId: 703907,
      StreetName: "Vojvođanska",
      StreetNumber: "401",
      Latitude: 44.8001239,
      Longitude: 20.3253489,
    });
    expect(payload.Waypoints[1]?.Address).toMatchObject({
      TownId: 791113,
      StreetName: "Bulevar oslobođenja",
      StreetNumber: "10A",
    });
    expect(payload.Waypoints[2]?.Address).not.toHaveProperty("Latitude");
    expect(payload.Options).toEqual([
      {
        OptionTypeId: 2,
        Data: {
          Name: "Svet povoljnih cena",
          Amount: 12_345.67,
          Account: "265-3310310005375-34",
          Address: "Vojvođanska 401 Surčin",
        },
      },
    ]);
    expect(payload.Packages).toEqual([
      { Code: "AAA0850300001", Mass: 1.8, Content: "Stolica" },
      { Code: "AAA0850300002", Mass: 1.8, Content: "Stolica" },
    ]);
  });

  it("omits COD options for prepaid orders", () => {
    const payload = buildXExpressCreateOrderPayload({
      cfg: config,
      reference: "758bb513-499d-4ab1-8697-5e747602f222",
      trackingCodes: ["AAA0850300001"],
      order: { ...order, paymentMethod: "UPLATA_NA_RACUN" },
      townId: 791113,
    });
    expect(payload).not.toHaveProperty("Options");
  });

  it("omits COD options from the second half of a split order", () => {
    const payload = buildXExpressCreateOrderPayload({
      cfg: config,
      reference: "758bb513-499d-4ab1-8697-5e747602f222",
      trackingCodes: ["AAA0850300001"],
      order: { ...order, total: 0 },
      townId: 791113,
    });
    expect(payload).not.toHaveProperty("Options");
  });

  it("uses operator-confirmed package masses when they are supplied", () => {
    const payload = buildXExpressCreateOrderPayload({
      cfg: config,
      reference: "758bb513-499d-4ab1-8697-5e747602f222",
      trackingCodes: ["AAA0850300001", "AAA0850300002"],
      packageMasses: [1.25, 2.5],
      order,
      townId: 791113,
    });
    expect(payload.Packages.map((pkg) => pkg.Mass)).toEqual([1.25, 2.5]);
  });

  it("keeps the exact product name on each individual package", () => {
    const payload = buildXExpressCreateOrderPayload({
      cfg: config,
      reference: "758bb513-499d-4ab1-8697-5e747602f222",
      trackingCodes: [
        "AAA0850300001",
        "AAA0850300002",
        "AAA0850300003",
      ],
      packageMasses: [1, 2, 3],
      packageContents: ["Ergo Lux", "Urban Seat", "Clean Box"],
      order: {
        ...order,
        items: [
          { ...order.items[0]!, name: "Ergo Lux", qty: 1 },
          { ...order.items[0]!, name: "Urban Seat", qty: 1 },
          { ...order.items[0]!, name: "Clean Box", qty: 1 },
        ],
      },
      townId: 791113,
    });

    expect(payload.Packages.map((pkg) => pkg.Content)).toEqual([
      "Ergo Lux",
      "Urban Seat",
      "Clean Box",
    ]);
  });

  it("blocks reclamation pickup until exact customer coordinates are available", () => {
    expect(() =>
      buildXExpressCreateOrderPayload({
        cfg: config,
        reference: "reclamation-return-1",
        trackingCodes: ["AAA0850300001"],
        order,
        townId: 791113,
        officialStreetName: "Bulevar oslobođenja",
        purpose: "RECLAMATION_RETURN",
      }),
    ).toThrow(/pickup koordinate kupca/);
  });

  it("normalizes Serbian phone and splits street number", () => {
    expect(normalizeXExpressPhone("+381 (64) 123-4567")).toBe("381641234567");
    expect(normalizeXExpressPhone("064 123 4567")).toBe("381641234567");
    expect(splitXExpressStreet("Vojvođanska 401")).toEqual({
      streetName: "Vojvođanska",
      streetNumber: "401",
    });
    expect(splitXExpressStreet("Bulevar oslobođenja 10 A")).toEqual({
      streetName: "Bulevar oslobođenja",
      streetNumber: "10A",
    });
    expect(normalizeXExpressStreetNumber("25a / 3 / 29")).toBe("25a/3/29");
    expect(splitXExpressStreet("Cara Dušana BB")).toEqual({
      streetName: "Cara Dušana",
      streetNumber: "BB",
    });
    expect(() => normalizeXExpressPhone("123")).toThrow(/formatu 381/);
    expect(() => normalizeXExpressPhone("381001234567890")).toThrow(/formatu 381/);
  });

  it("rejects a COD bank account outside the documented 3-13-2 format", () => {
    expect(() =>
      buildXExpressCreateOrderPayload({
        cfg: { ...config, cod: { ...config.cod, account: "123456" } },
        reference: "order-100",
        trackingCodes: ["AAA0850300001"],
        order,
        townId: 791113,
      }),
    ).toThrow(/3-13-2/);

    expect(() =>
      buildXExpressCreateOrderPayload({
        cfg: {
          ...config,
          cod: { ...config.cod, account: "265-3310310005375-35" },
        },
        reference: "order-101",
        trackingCodes: ["AAA0850300001"],
        order,
        townId: 791113,
      }),
    ).toThrow(/MOD97/);
  });

  it("sanitizes provider text and omits overlong optional email fields", () => {
    const payload = buildXExpressCreateOrderPayload({
      cfg: {
        ...config,
        pickup: {
          ...config.pickup,
          contactEmail: `${"a".repeat(45)}@example.com`,
        },
        cod: {
          ...config.cod,
          address: "Vojvođanska 401, 11000 Beograd",
        },
      },
      reference: "order#100/1",
      trackingCodes: ["AAA0850300001"],
      order: {
        ...order,
        shipCompanyName: "Kupac & partner (maloprodaja)",
        notes: "Pozvati! ulaz #2 + sprat",
        guestEmail: `${"b".repeat(45)}@example.com`,
        items: [{ ...order.items[0]!, name: "LED 10.5W & zidna lampa ©" }],
      },
      townId: 791113,
    });

    expect(payload.Sender).not.toHaveProperty("Email");
    expect(payload.Recipient).not.toHaveProperty("Email");
    expect(payload.Recipient.Name).toBe("Kupac i partner maloprodaja");
    expect(payload.Content).toBe("LED 10 5W i zidna lampa");
    expect(payload.Waypoints[1]?.Address.Description).toBe(
      "Pozvati ulaz 2 plus sprat",
    );
    expect(payload.Options?.[0]?.Data.Address).toBe(
      "Vojvođanska 401 11000 Beograd",
    );
  });

  it("accepts area as a successful address result and requestGuid as create result", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ area: "vs-bg-02" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ requestGuid: "758bb513-499d-4ab1-8697-5e747602f222" }),
          { status: 202 },
        ),
      );
    const client = new XExpressClient(config, fetchMock);
    const addressPayload = buildXExpressAddressCheckPayload({
      recipientName: "Petar Petrović",
      townId: 791113,
      street: "Bulevar oslobođenja 10A",
    });
    await expect(client.checkAddress(addressPayload)).resolves.toMatchObject({
      valid: true,
      area: "VS-BG-02",
    });
    const createPayload = buildXExpressCreateOrderPayload({
      cfg: config,
      reference: "758bb513-499d-4ab1-8697-5e747602f222",
      trackingCodes: ["AAA0850300001"],
      order,
      townId: 791113,
    });
    await expect(client.createOrder(createPayload)).resolves.toMatchObject({
      requestGuid: "758bb513-499d-4ab1-8697-5e747602f222",
      trackingNo: "AAA0850300001",
      providerShipmentId: "758bb513-499d-4ab1-8697-5e747602f222",
      labelUrl: null,
    });

    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual(addressPayload);
    expect(new Headers(request?.headers).get("x-api-user")).toBe("api-user");
    expect(new Headers(request?.headers).get("x-api-key")).toBe("api-key");
  });

  it("flattens ASP.NET ProblemDetails field errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          title: "Validation failed",
          errors: { StreetNumber: ["StreetNumber is required."] },
        }),
        { status: 400 },
      ),
    );
    const client = new XExpressClient(config, fetchMock);
    await expect(
      client.checkAddress({
        Name: "Petar Petrović",
        TownId: 791113,
        StreetName: "Bulevar oslobođenja",
        StreetNumber: "10A",
        Description: null,
      }),
    ).rejects.toMatchObject({
      message: "StreetNumber: StreetNumber is required.",
    });
  });
});

describe("X Express codes, label and webhook envelope", () => {
  it("pads the assigned 9-digit range to a 13-character package code", () => {
    expect(formatXExpressTrackingCode("AAA", 850300001)).toBe("AAA0850300001");
    expect(formatXExpressTrackingCode("AAA", 850300001)).toHaveLength(13);
  });

  it("starts Code-128 in set A and switches numeric suffix to set C", () => {
    expect(encodeXExpressCode128("AAA0850300001")).toEqual([
      103, 33, 33, 33, 99, 8, 50, 30, 0, 1,
    ]);
  });

  it("accepts documented and production route formats", () => {
    expect(normalizeXExpressRouteCode("ča-ok-54")).toBe("ČA-OK-54");
    expect(normalizeXExpressRouteCode(" bg-ze-4 ")).toBe("BG-ZE-4");
    expect(normalizeXExpressRouteCode("ns-0")).toBe("NS-0");
    expect(normalizeXExpressRouteCode("VS")).toBeNull();
    expect(normalizeXExpressRouteCode("REON")).toBeNull();
  });

  it("maps official pickup, delivery, PUDO, return and failure statuses", () => {
    expect(inferXExpressShipmentStatus("REQUEST_RECEIVED", "Kreiran zahtev")).toBe(
      "CREATED",
    );
    expect(inferXExpressShipmentStatus("PCK_ASGN_OVERLOAD", "Preopterećen kurir")).toBe(
      "CREATED",
    );
    expect(inferXExpressShipmentStatus("PICKEDUP", "Preuzeta od pošiljaoca")).toBe(
      "PICKED_UP",
    );
    expect(inferXExpressShipmentStatus("DLV_TO_PUDO", "Pudo - preusmerena")).toBe(
      "OUT_FOR_DELIVERY",
    );
    expect(inferXExpressShipmentStatus("PUDO_RETRIEVED", "Pudo - preuzeta")).toBe(
      "DELIVERED",
    );
    expect(inferXExpressShipmentStatus("RETURNING", "Kreiran povrat")).toBe(
      "IN_TRANSIT",
    );
    expect(inferXExpressShipmentStatus("RETURNED", "Vraćena")).toBe("RETURNED");
    expect(inferXExpressShipmentStatus("DLV_FAIL_ADDRESS_ERR", "Netačna adresa")).toBe(
      "FAILED",
    );
    expect(inferXExpressShipmentStatus("LOST", "Izgubljena")).toBe("FAILED");
  });

  it("uses the shared payment gate before the courier announcement", () => {
    expect(
      isXExpressAnnouncementPaymentReady({
        purpose: "ORDER_DELIVERY",
        paymentMethod: "UPLATA_NA_RACUN",
        paymentStatuses: ["PENDING"],
      }),
    ).toBe(false);
    expect(
      isXExpressAnnouncementPaymentReady({
        purpose: "ORDER_DELIVERY",
        paymentMethod: "UPLATA_NA_RACUN",
        paymentStatuses: ["PAID"],
      }),
    ).toBe(true);
    expect(
      isXExpressAnnouncementPaymentReady({
        purpose: "ORDER_DELIVERY",
        paymentMethod: "POUZECE_GOTOVINA",
        paymentStatuses: ["PENDING"],
      }),
    ).toBe(true);
    expect(
      isXExpressAnnouncementPaymentReady({
        purpose: "RECLAMATION_REPLACEMENT",
        paymentMethod: "UPLATA_NA_RACUN",
        paymentStatuses: [],
      }),
    ).toBe(true);
  });

  it("renders 95x138 ERP labels from the exact payload accepted by X Express", () => {
    const labelPayload = buildXExpressCreateOrderPayload({
      cfg: config,
      reference: "758bb513-499d-4ab1-8697-5e747602f222",
      trackingCodes: ["AAA0850300001", "AAA0850300002"],
      order: { ...order, shipCompanyName: "Petrović enterijer DOO" },
      townId: 791113,
      officialStreetName: "Bulevar oslobođenja",
      packageMasses: [1.8, 2.2],
    });
    const labelData = buildXExpressLabelData({
      payload: labelPayload,
      pickupTown: {
        name: "Beograd",
        displayName: "Beograd - Surčin",
        postalCode: "11271",
      },
      deliveryCity: "Novi Sad",
      deliveryPostalCode: "21000",
    });
    const shipment = {
      id: "758bb513-499d-4ab1-8697-5e747602f222",
      trackingNo: "AAA0850300001",
      packageCount: 2,
      providerParcelNumbers: ["AAA0850300001", "AAA0850300002"],
      providerRouteCode: "BG-ZE-4",
      providerRouteName: null,
      rawCreateResponse: {
        labelData,
        packages: [
          { Code: "AAA0850300001", Mass: 1.8, Content: "Stolica" },
          { Code: "AAA0850300002", Mass: 2.2, Content: "Sto" },
        ],
      },
      createdAt: new Date("2026-07-26T12:00:00Z"),
      order: {
        number: "WEB-2026-0001",
        total: 12_345.67,
        paymentMethod: "POUZECE_GOTOVINA" as const,
        shipFirstName: "Petar",
        shipLastName: "Petrović",
        shipCompanyName: "Petrović enterijer DOO",
        shipPhone: "0642223344",
        shipStreet: "Naknadno promenjena adresa 99",
        shipCity: "Promenjen grad",
        shipPostalCode: "99999",
        notes: "Pozvati",
        items: [{ name: "Stolica", qty: 1 }],
      },
    };
    const html = renderXExpressLabelsHtml(shipment);
    expect(html).toContain("width: 95mm; height: 138mm");
    expect(html).toContain(
      "X Express doo, Đorđa Ognjanovića 16, Beograd-Čukarica",
    );
    expect(html).toContain("X Express ne vraća PDF adresnicu kroz API");
    expect(html).toContain("Vojvođanska 401, 11271 Beograd - Surčin");
    expect(html).not.toContain("DC magacin");
    expect(html).not.toContain("381641234567");
    expect(html).toContain("Petrović enterijer DOO");
    expect(html).toContain("Bulevar oslobođenja 10A");
    expect(html).not.toContain("Naknadno promenjena adresa 99");
    expect(html).toContain("BG-ZE-4");
    expect(html).toContain("1/2");
    expect(html).toContain("2/2");
    expect(html).toContain("1,8 kg");
    expect(html).toContain("2,2 kg");
    expect(html).toContain("12.346 RSD");
    const firstLabel = html.match(
      /<section class="label">([\s\S]*?)<\/section>/,
    )?.[1];
    const secondLabel = html.match(
      /<section class="label">[\s\S]*?<\/section>\s*<section class="label">([\s\S]*?)<\/section>/,
    )?.[1];
    expect(firstLabel).toContain("Sadržaj:</strong> Stolica");
    expect(firstLabel).not.toContain("Sadržaj:</strong> Sto</div>");
    expect(secondLabel).toContain("Sadržaj:</strong> Sto");
    expect(secondLabel).not.toContain("Sadržaj:</strong> Stolica</div>");

    const batchHtml = renderXExpressBatchLabelsHtml(
      [
        shipment,
        {
          ...shipment,
          id: "shipment-2",
          trackingNo: "AAA0850300003",
          packageCount: 1,
          providerParcelNumbers: ["AAA0850300003"],
          order: { ...shipment.order, number: "WEB-2026-0002" },
        },
      ],
      { title: "PRE-2026-0002", autoPrint: true },
    );
    expect(batchHtml.match(/<!doctype html>/g)).toHaveLength(1);
    expect(batchHtml.match(/<section class="label">/g)).toHaveLength(3);
    expect(batchHtml.match(/<main class="sheet"/g)).toHaveLength(1);
    expect(batchHtml).toContain("X Express adresnice PRE-2026-0002");
    expect(batchHtml).toContain("window.print()");

    const fiveLabelHtml = renderXExpressBatchLabelsHtml([
      {
        ...shipment,
        packageCount: 5,
        providerParcelNumbers: [
          "AAA0850300001",
          "AAA0850300002",
          "AAA0850300003",
          "AAA0850300004",
          "AAA0850300005",
        ],
      },
    ]);
    const sheets = [
      ...fiveLabelHtml.matchAll(
        /<main class="sheet" data-sheet="\d+">([\s\S]*?)<\/main>/g,
      ),
    ];
    expect(sheets).toHaveLength(2);
    expect(sheets[0]?.[1].match(/<section class="label">/g)).toHaveLength(4);
    expect(sheets[1]?.[1].match(/<section class="label">/g)).toHaveLength(1);
    expect(fiveLabelHtml).toContain("@page { size: A4 portrait; margin: 0; }");
    expect(fiveLabelHtml).toContain("page-break-after: always");
  });

  it("repairs legacy combined content from the pickup package order", () => {
    const base = {
      id: "legacy-shipment",
      trackingNo: "AAA0850300001",
      packageCount: 2,
      providerParcelNumbers: ["AAA0850300001", "AAA0850300002"],
      providerRouteCode: "BG-NB-12",
      providerRouteName: null,
      rawCreateResponse: null,
      createdAt: new Date("2026-07-26T12:00:00Z"),
      order: {
        number: "WEB-LEGACY-1",
        total: 0,
        paymentMethod: "UPLATA_NA_RACUN" as const,
        shipFirstName: "Petar",
        shipLastName: "Petrović",
        shipCompanyName: null,
        shipPhone: "0642223344",
        shipStreet: "Bulevar oslobođenja 10A",
        shipCity: "Beograd",
        shipPostalCode: "11000",
        notes: null,
        items: [
          { name: "Trpezarijski sto HOME STYLE", qty: 1 },
          { name: "Trpezarijski sto URBANE", qty: 1 },
        ],
      },
    };
    const html = renderXExpressBatchLabelsHtml([base], {
      packageContentsByShipmentId: {
        "legacy-shipment": [
          "Trpezarijski sto HOME STYLE",
          "Trpezarijski sto URBANE",
        ],
      },
    });
    const labels = [...html.matchAll(/<section class="label">([\s\S]*?)<\/section>/g)];
    expect(labels).toHaveLength(2);
    expect(labels[0]?.[1]).toContain("Trpezarijski sto HOME STYLE");
    expect(labels[0]?.[1]).not.toContain("Trpezarijski sto URBANE");
    expect(labels[1]?.[1]).toContain("Trpezarijski sto URBANE");
    expect(labels[1]?.[1]).not.toContain("Trpezarijski sto HOME STYLE");
  });

  it("refuses to duplicate a barcode when one package code is missing", () => {
    const invalid = {
      id: "missing-code",
      trackingNo: "AAA0850300001",
      packageCount: 2,
      providerParcelNumbers: ["AAA0850300001"],
      providerRouteCode: "BG-NB-12",
      providerRouteName: null,
      rawCreateResponse: null,
      createdAt: new Date(),
      order: {
        number: "WEB-MISSING-CODE",
        total: 0,
        paymentMethod: "UPLATA_NA_RACUN" as const,
        shipFirstName: "Petar",
        shipLastName: "Petrović",
        shipCompanyName: null,
        shipPhone: "0642223344",
        shipStreet: "Bulevar oslobođenja 10A",
        shipCity: "Beograd",
        shipPostalCode: "11000",
        notes: null,
        items: [{ name: "Sto", qty: 1 }],
      },
    };
    expect(() => renderXExpressLabelsHtml(invalid)).toThrow(
      /nema 2 jedinstvenih kodova/,
    );
  });

  it("requires exact webhook authentication, contract and schema", () => {
    vi.stubEnv("X_EXPRESS_WEBHOOK_API_KEY", "webhook-key");
    vi.stubEnv("X_EXPRESS_WEBHOOK_SECRET", "legacy-webhook-key");
    vi.stubEnv("X_EXPRESS_API_KEY", "api-key");
    vi.stubEnv("X_EXPRESS_CONTRACT_CODE", "U000328");
    const headers = new Headers({
      "X-API-Sender": "XExpress",
      "X-API-Key": "webhook-key",
    });
    expect(verifyXExpressWebhookHeaders(headers)).toBe(true);
    headers.set("X-API-Sender", "someone-else");
    expect(verifyXExpressWebhookHeaders(headers)).toBe(false);
    headers.set("X-API-Sender", "XExpress");
    headers.set("X-API-Key", "api-key");
    expect(verifyXExpressWebhookHeaders(headers)).toBe(true);
    headers.set("X-API-Key", "legacy-webhook-key");
    expect(verifyXExpressWebhookHeaders(headers)).toBe(true);
    headers.set("X-API-Key", "unrecognized-key");
    expect(verifyXExpressWebhookHeaders(headers)).toBe(false);

    const batch = parseXExpressWebhookBatch([
      {
        ContractId: "U000328",
        NotifyId: "758bb513-499d-4ab1-8697-5e747602f222",
        OrderCode: "1000001",
        ReferenceId: "f32f5f7a-ec27-43c5-a7d9-5f628834b0fa",
        ReferenceGuid: "4c4d7389-bf92-4c39-8cd8-91014c410a18",
        Status: "20",
        StatusTime: "2026-07-26T12:00:00Z",
      },
    ]);
    expect(isXExpressWebhookContractValid(batch)).toBe(true);
    expect(
      isXExpressWebhookContractValid([{ ...batch[0]!, ContractId: "U999999" }]),
    ).toBe(false);
    expect(() =>
      parseXExpressWebhookBatch([{ ...batch[0]!, NotifyId: "not-a-uuid" }]),
    ).toThrow();
  });
});
