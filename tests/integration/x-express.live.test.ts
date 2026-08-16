import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { describe, expect, it } from "vitest";
import { XExpressClient } from "@/lib/x-express/client";
import { formatXExpressTrackingCode } from "@/lib/x-express/code";
import {
  requireXExpressEnabled,
  requireXExpressShipmentConfig,
} from "@/lib/x-express/config";
import { normalizeXExpressPhone } from "@/lib/x-express/payload";
import type { XExpressCreateOrderPayload } from "@/lib/x-express/types";

loadEnv({ path: ".env.local" });
loadEnv();

const enabled = process.env.X_EXPRESS_LIVE_TEST === "1";

describe.skipIf(!enabled)("X Express provider test account", () => {
  it("authenticates and downloads the official status dictionary", async () => {
    const cfg = requireXExpressEnabled();
    expect(cfg.env).toBe("test");
    expect(cfg.apiUser).not.toBe("");
    expect(cfg.apiKey).not.toBe("");
    expect(cfg.contractCode).toMatch(/^U\d{6}$/);

    const client = new XExpressClient({ ...cfg, enabled: true });
    const statuses = await client.fetchStatusCodes();
    expect(statuses.length).toBeGreaterThan(40);
    expect(statuses.find((item) => item.code === "PICKEDUP")?.shipmentStatus).toBe(
      "PICKED_UP",
    );
    expect(
      statuses.find((item) => item.code === "PUDO_RETRIEVED")?.shipmentStatus,
    ).toBe("DELIVERED");
  });

  it("accepts the configured pickup address", async () => {
    const cfg = requireXExpressEnabled();
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

  it("accepts order/add with the first sequentially assigned package code", async () => {
    const cfg = requireXExpressShipmentConfig();
    const client = new XExpressClient({ ...cfg, enabled: true });
    // X Express requires a provider allocation bound to this exact API user.
    // Repository examples are rejected before any provider request is sent.
    const value = cfg.codeRangeStart!;
    const code = formatXExpressTrackingCode(cfg.codePrefix, value);
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
      Packages: [{ Code: code, Mass: 1, Content: "API acceptance test" }],
    };
    const created = await client.createOrder(payload);
    expect(created.requestGuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(created.trackingNo).toBe(code);
    expect(created.providerShipmentId).toBe(created.requestGuid);
  });
});
