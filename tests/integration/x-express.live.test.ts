import { randomInt, randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { describe, expect, it } from "vitest";
import { XExpressClient } from "@/lib/x-express/client";
import { formatXExpressTrackingCode } from "@/lib/x-express/code";
import { getXExpressConfig } from "@/lib/x-express/config";
import type { XExpressCreateOrderPayload } from "@/lib/x-express/types";

loadEnv({ path: ".env.local" });
loadEnv();

const enabled = process.env.X_EXPRESS_LIVE_TEST === "1";

describe.skipIf(!enabled)("X Express provider test account", () => {
  it("accepts official check-address and add payloads", async () => {
    const cfg = getXExpressConfig();
    expect(cfg.env).toBe("test");
    expect(cfg.apiUser).not.toBe("");
    expect(cfg.apiKey).not.toBe("");
    expect(cfg.contractCode).toMatch(/^U\d{6}$/);
    expect(cfg.codeRangeStart).not.toBeNull();
    expect(cfg.codeRangeEnd).not.toBeNull();

    const client = new XExpressClient({ ...cfg, enabled: true });
    const statuses = await client.fetchStatusCodes();
    expect(statuses.length).toBeGreaterThan(40);
    expect(statuses.find((item) => item.code === "PICKEDUP")?.shipmentStatus).toBe(
      "PICKED_UP",
    );
    expect(
      statuses.find((item) => item.code === "PUDO_RETRIEVED")?.shipmentStatus,
    ).toBe("DELIVERED");
    const address = await client.checkAddress({
      Name: "Codex QA test",
      TownId: 703907,
      StreetName: "Vojvođanska",
      StreetNumber: "401",
      Description: null,
    });
    expect(address.area).toMatch(/^[A-Z0-9-]+$/i);

    const value = randomInt(cfg.codeRangeStart!, cfg.codeRangeEnd! + 1);
    const code = formatXExpressTrackingCode(cfg.codePrefix, value);
    const reference = randomUUID();
    const payload: XExpressCreateOrderPayload = {
      ContractCode: cfg.contractCode,
      Reference: reference,
      Sender: { Name: "Codex QA test", Phone: "381641234567" },
      Recipient: { Name: "Codex QA test", Phone: "381641234567" },
      ServicePayerId: 1,
      TypeId: 1,
      Content: "API acceptance test",
      Waypoints: [
        {
          Address: {
            Name: "Codex QA test",
            TownId: 703907,
            StreetName: "Vojvođanska",
            StreetNumber: "401",
            Latitude: 44.8001239,
            Longitude: 20.3253489,
            Description: "Provider test account only",
          },
          Contact: { Name: "Codex QA test", Phone: "381641234567" },
          WaypointType: "PICKUP",
        },
        {
          Address: {
            Name: "Codex QA test",
            TownId: 703907,
            StreetName: "Vojvođanska",
            StreetNumber: "401",
            Description: "Provider test account only",
          },
          Contact: { Name: "Codex QA test", Phone: "381641234567" },
          WaypointType: "DELIVERY",
        },
        {
          Address: {
            Name: "Codex QA test",
            TownId: 703907,
            StreetName: "Vojvođanska",
            StreetNumber: "401",
            Description: "Provider test return",
          },
          Contact: { Name: "Codex QA test", Phone: "381641234567" },
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
