import assert from "node:assert/strict";
import test from "node:test";
import {
  extractRequestGuid,
  isXExpressOrderCode,
  manifestFingerprint,
  manifestTuple,
} from "./x-express-production-replay.mjs";

function candidate(overrides = {}) {
  return {
    id: "shipment-1",
    trackingNo: "AAA0850300037",
    providerShipmentId: "43d68a71-efbd-4494-83e7-e5a9e5b2dcea",
    providerStatusCode: null,
    order: { number: "SPC-2026-000046" },
    rawCreateResponse: {
      createOrderPayload: {
        Reference: "shipment-1",
        Packages: [{ Code: "AAA0850300037" }],
      },
      xExpressAnnouncement: {
        state: "ANNOUNCED",
        requestGuid: "43d68a71-efbd-4494-83e7-e5a9e5b2dcea",
      },
    },
    ...overrides,
  };
}

test("extractRequestGuid prihvata direktan i ugnježden odgovor", () => {
  const guid = "2df1e75f-2d09-4e1c-9f56-92318a56c77e";
  assert.equal(extractRequestGuid({ requestGuid: guid }), guid);
  assert.equal(extractRequestGuid({ data: { RequestGuid: guid } }), guid);
  assert.equal(extractRequestGuid({ data: { ok: true } }), null);
});

test("manifest tuple koristi originalni test GUID i posle produkcionog replay-a", () => {
  const before = candidate();
  const after = candidate({
    providerShipmentId: "c0af3ed0-aabb-4e7f-9e52-29e87c82cf67",
    providerStatusCode: "PRODUCTION_ANNOUNCED",
    rawCreateResponse: {
      ...before.rawCreateResponse,
      xExpressProductionReplay: {
        state: "ANNOUNCED",
        testRequestGuid: before.providerShipmentId,
        productionRequestGuid: "c0af3ed0-aabb-4e7f-9e52-29e87c82cf67",
      },
    },
  });
  assert.equal(manifestTuple(before), manifestTuple(after));
  assert.equal(manifestFingerprint([before]), manifestFingerprint([after]));
});

test("promena tracking koda menja fingerprint", () => {
  const original = candidate();
  const changed = candidate({ trackingNo: "AAA0850300038" });
  assert.notEqual(manifestFingerprint([original]), manifestFingerprint([changed]));
});

test("X Express produkcioni broj naloga ima strogo očekivan format", () => {
  assert.equal(isXExpressOrderCode("26-0001027768"), true);
  assert.equal(isXExpressOrderCode("26-1027768"), false);
  assert.equal(isXExpressOrderCode("26-0001027768-extra"), false);
});
