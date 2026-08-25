import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { describe, expect, it } from "vitest";
import { XExpressClient } from "@/lib/x-express/client";
import { formatXExpressTrackingCode } from "@/lib/x-express/code";
import { requireXExpressShipmentConfig } from "@/lib/x-express/config";
import { normalizeXExpressPhone } from "@/lib/x-express/payload";
import type { XExpressCreateOrderPayload } from "@/lib/x-express/types";

loadEnv({ path: ".env.local" });
loadEnv();

const enabled = process.env.X_EXPRESS_LIVE_TEST === "1";

describe.skipIf(!enabled)("X Express provider test account", () => {
  it("authenticates and downloads every official dictionary", async () => {
    const cfg = requireXExpressShipmentConfig();
    expect(cfg.env).toBe("test");
    expect(cfg.apiUser).not.toBe("");
    expect(cfg.apiKey).not.toBe("");
    expect(cfg.contractCode).toMatch(/^U\d{6}$/);
    expect(cfg.codeRangeStart).not.toBeNull();
    expect(cfg.codeRangeEnd).not.toBeNull();

    const client = new XExpressClient({ ...cfg, enabled: true });
    const municipalities = await client.fetchMunicipalities();
    const towns = await client.fetchTowns();
    const streets = await client.fetchStreets();
    const statuses = await client.fetchStatusCodes();
    expect(municipalities.length).toBeGreaterThan(100);
    expect(towns.length).toBeGreaterThan(4_000);
    expect(streets.length).toBeGreaterThan(30_000);
    expect(statuses.length).toBeGreaterThan(40);
    expect(towns.some((town) => town.id === cfg.pickup.townId)).toBe(true);
    expect(statuses.find((item) => item.code === "PICKEDUP")?.shipmentStatus).toBe(
      "PICKED_UP",
    );
    expect(
      statuses.find((item) => item.code === "PUDO_RETRIEVED")?.shipmentStatus,
    ).toBe("DELIVERED");
  });

  it("rejects an invalid API key", async () => {
    const cfg = requireXExpressShipmentConfig();
    const client = new XExpressClient({
      ...cfg,
      enabled: true,
      apiKey: `invalid-${randomUUID()}`,
    });
    await expect(client.fetchStatusCodes()).rejects.toThrow(/HTTP 401/);
  });

  it("accepts the configured pickup address", async () => {
    const cfg = requireXExpressShipmentConfig();
    const client = new XExpressClient({ ...cfg, enabled: true });
    const address = await client.checkAddress({
      Name: cfg.pickup.name,
      TownId: cfg.pickup.townId!,
      StreetName: cfg.pickup.streetName,
      StreetNumber: cfg.pickup.streetNumber,
      Description: null,
    });
    expect(address.area).toBe("SM-5");
  });

  it("rejects incomplete and unknown addresses", async () => {
    const cfg = requireXExpressShipmentConfig();
    const client = new XExpressClient({ ...cfg, enabled: true });
    await expect(
      client.checkAddress({
        Name: cfg.pickup.name,
        TownId: cfg.pickup.townId!,
        StreetName: cfg.pickup.streetName,
        StreetNumber: "",
        Description: null,
      }),
    ).rejects.toThrow(/StreetNumber field is required/);
    await expect(
      client.checkAddress({
        Name: cfg.pickup.name,
        TownId: 0,
        StreetName: cfg.pickup.streetName,
        StreetNumber: cfg.pickup.streetNumber,
        Description: null,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("accepts order/add with two sequentially assigned package codes", async () => {
    const cfg = requireXExpressShipmentConfig();
    const client = new XExpressClient({ ...cfg, enabled: true });
    // X Express requires strict sequential allocation beginning with the first
    // assigned value. The test account does not consume the code.
    const value = cfg.codeRangeStart!;
    const codes = [
      formatXExpressTrackingCode(cfg.codePrefix, value),
      formatXExpressTrackingCode(cfg.codePrefix, value + 1),
    ];
    const reference = randomUUID();
    const pickupPhone = normalizeXExpressPhone(cfg.pickup.contactPhone);
    const payload: XExpressCreateOrderPayload = {
      ContractCode: cfg.contractCode,
      Reference: reference,
      Sender: { Name: cfg.pickup.name, Phone: pickupPhone },
      Recipient: { Name: "Codex QA test", Phone: pickupPhone },
      ServicePayerId: cfg.servicePayerId,
      TypeId: cfg.serviceTypeId,
      Content: "API acceptance test",
      Waypoints: [
        {
          Address: {
            Name: cfg.pickup.name,
            TownId: cfg.pickup.townId!,
            StreetName: cfg.pickup.streetName,
            StreetNumber: cfg.pickup.streetNumber,
            Latitude: cfg.pickup.latitude!,
            Longitude: cfg.pickup.longitude!,
            Description: cfg.pickup.description,
          },
          Contact: { Name: cfg.pickup.contactName, Phone: pickupPhone },
          WaypointType: "PICKUP",
        },
        {
          Address: {
            Name: "Codex QA test",
            TownId: cfg.pickup.townId!,
            StreetName: cfg.pickup.streetName,
            StreetNumber: cfg.pickup.streetNumber,
            Description: "Provider test account only",
          },
          Contact: { Name: "Codex QA test", Phone: pickupPhone },
          WaypointType: "DELIVERY",
        },
        {
          Address: {
            Name: cfg.pickup.name,
            TownId: cfg.pickup.townId!,
            StreetName: cfg.pickup.streetName,
            StreetNumber: cfg.pickup.streetNumber,
            Description: "Provider test return",
          },
          Contact: { Name: cfg.pickup.contactName, Phone: pickupPhone },
          WaypointType: "RETURN",
        },
      ],
      Packages: codes.map((Code, index) => ({
        Code,
        Mass: index + 1,
        Content: "API acceptance test",
      })),
    };
    const created = await client.createOrder(payload);
    expect(created.requestGuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(created.trackingNo).toBe(codes[0]);
    expect(created.providerShipmentId).toBe(created.requestGuid);
  });

  it("rejects malformed package codes and the wrong contract", async () => {
    const cfg = requireXExpressShipmentConfig();
    const client = new XExpressClient({ ...cfg, enabled: true });
    const pickupPhone = normalizeXExpressPhone(cfg.pickup.contactPhone);
    const basePayload: XExpressCreateOrderPayload = {
      ContractCode: cfg.contractCode,
      Reference: randomUUID(),
      Sender: { Name: cfg.pickup.name, Phone: pickupPhone },
      Recipient: { Name: "Codex QA test", Phone: pickupPhone },
      ServicePayerId: cfg.servicePayerId,
      TypeId: cfg.serviceTypeId,
      Content: "API negative test",
      Waypoints: [
        {
          Address: {
            Name: cfg.pickup.name,
            TownId: cfg.pickup.townId!,
            StreetName: cfg.pickup.streetName,
            StreetNumber: cfg.pickup.streetNumber,
            Latitude: cfg.pickup.latitude!,
            Longitude: cfg.pickup.longitude!,
            Description: cfg.pickup.description,
          },
          Contact: { Name: cfg.pickup.contactName, Phone: pickupPhone },
          WaypointType: "PICKUP",
        },
        {
          Address: {
            Name: "Codex QA test",
            TownId: cfg.pickup.townId!,
            StreetName: cfg.pickup.streetName,
            StreetNumber: cfg.pickup.streetNumber,
            Description: "Provider test account only",
          },
          Contact: { Name: "Codex QA test", Phone: pickupPhone },
          WaypointType: "DELIVERY",
        },
        {
          Address: {
            Name: cfg.pickup.name,
            TownId: cfg.pickup.townId!,
            StreetName: cfg.pickup.streetName,
            StreetNumber: cfg.pickup.streetNumber,
            Description: "Provider test return",
          },
          Contact: { Name: cfg.pickup.contactName, Phone: pickupPhone },
          WaypointType: "RETURN",
        },
      ],
      Packages: [{ Code: "BAD", Mass: 1, Content: "API negative test" }],
    };

    await expect(client.createOrder(basePayload)).rejects.toThrow(
      /Package code: BAD is not valid/,
    );
    await expect(
      client.createOrder({
        ...basePayload,
        ContractCode: "U999999",
        Reference: randomUUID(),
        Packages: [
          {
            Code: formatXExpressTrackingCode(
              cfg.codePrefix,
              cfg.codeRangeStart!,
            ),
            Mass: 1,
            Content: "API negative test",
          },
        ],
      }),
    ).rejects.toThrow(/Nevažeći ugovor/);
  });
});
