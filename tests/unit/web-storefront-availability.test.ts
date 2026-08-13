import { afterEach, describe, expect, it } from "vitest";
import {
  isProductAvailableOnWeb,
  isWebAutoAvailabilityEnforced,
  storefrontPublicationBlockers,
  storefrontAvailabilityWhere,
  webStorefrontProductWhere,
} from "@/lib/web-storefront-availability";

const original = process.env.ENFORCE_WEB_AUTO_AVAILABILITY;
const originalRabalux = process.env.RABALUX_ENABLED;

afterEach(() => {
  if (original === undefined) {
    delete process.env.ENFORCE_WEB_AUTO_AVAILABILITY;
  } else {
    process.env.ENFORCE_WEB_AUTO_AVAILABILITY = original;
  }
  if (originalRabalux === undefined) delete process.env.RABALUX_ENABLED;
  else process.env.RABALUX_ENABLED = originalRabalux;
});

describe("web storefront availability rollout", () => {
  it("uses the manual Web check while DC availability enforcement is disabled", () => {
    delete process.env.ENFORCE_WEB_AUTO_AVAILABILITY;

    expect(isWebAutoAvailabilityEnforced()).toBe(false);
    expect(webStorefrontProductWhere()).toMatchObject({
      isActive: true,
      availableWebManual: true,
      priceListEntries: {
        some: {
          price: { gt: 0 },
          priceList: { is: { kind: "RETAIL", active: true } },
        },
      },
      AND: expect.any(Array),
    });
    expect(
      isProductAvailableOnWeb({
        isActive: true,
        availableWebManual: true,
        availableWebAuto: false,
      }),
    ).toBe(true);
  });

  it("always honors an administrator turning the Web check off", () => {
    process.env.ENFORCE_WEB_AUTO_AVAILABILITY = "false";

    expect(
      isProductAvailableOnWeb({
        isActive: true,
        availableWebManual: false,
        availableWebAuto: true,
      }),
    ).toBe(false);
  });

  it("keeps ordinary suppliers with a null integration key storefront-eligible", () => {
    process.env.ENFORCE_WEB_AUTO_AVAILABILITY = "false";

    const serialized = JSON.stringify(webStorefrontProductWhere());
    expect(serialized).toContain('"supplier":{"is":null}');
    expect(serialized).toContain('"integrationKey":null');
    expect(
      isProductAvailableOnWeb({
        isActive: true,
        availableWebManual: true,
        availableWebAuto: false,
        supplier: { integrationKey: null, enabled: true },
      }),
    ).toBe(true);
  });

  it("requires automatic DC availability when strict enforcement is enabled", () => {
    process.env.ENFORCE_WEB_AUTO_AVAILABILITY = "true";

    expect(isWebAutoAvailabilityEnforced()).toBe(true);
    expect(JSON.stringify(webStorefrontProductWhere())).toContain(
      '"availableWebAuto":true',
    );
    expect(
      isProductAvailableOnWeb({
        isActive: true,
        availableWebManual: true,
        availableWebAuto: false,
      }),
    ).toBe(false);
  });

  it("enforces the Rabalux >10 rule even while global auto availability is off", () => {
    process.env.ENFORCE_WEB_AUTO_AVAILABILITY = "false";
    process.env.RABALUX_ENABLED = "true";
    const base = {
      isActive: true,
      availableWebManual: true,
      availableWebAuto: false,
      dcAvailableQty: 0,
      supplierApprovalStatus: "APPROVED",
      lastSupplierStockSyncAt: new Date(),
      supplier: { integrationKey: "RABALUX", enabled: true },
    };

    expect(isProductAvailableOnWeb({ ...base, supplierStock: 10 })).toBe(false);
    expect(isProductAvailableOnWeb({ ...base, supplierStock: 11 })).toBe(true);
    expect(
      isProductAvailableOnWeb({
        ...base,
        supplierStock: 0,
        dcAvailableQty: 1,
      }),
    ).toBe(true);
    expect(
      isProductAvailableOnWeb({
        ...base,
        isActive: false,
        supplierStock: 50,
      }),
    ).toBe(false);
    expect(
      isProductAvailableOnWeb({
        ...base,
        isActive: true,
        articleStatus: "ARH",
        supplierStock: 50,
      }),
    ).toBe(false);
  });

  it("builds incoming and unavailable buckets without nullable relation negation", () => {
    const incoming = JSON.stringify(storefrontAvailabilityWhere(["incoming"]));
    const unavailable = JSON.stringify(
      storefrontAvailabilityWhere(["out-of-stock"]),
    );

    expect(incoming).toContain('"stock":{"lte":0}');
    expect(incoming).toContain('"incomingStock":{"gt":0}');
    expect(incoming).not.toContain('"NOT"');
    expect(unavailable).toContain('"incomingStock":{"lte":0}');
    expect(unavailable).not.toContain('"NOT"');
  });

  it("reports the exact retail-price and family publication gates", () => {
    process.env.ENFORCE_WEB_AUTO_AVAILABILITY = "false";
    expect(
      storefrontPublicationBlockers({
        isActive: true,
        availableWebManual: true,
        availableWebAuto: false,
        supplier: { integrationKey: null, enabled: true },
        hasActiveRetailPrice: false,
        familyStorefrontEnabled: false,
      }),
    ).toEqual([
      "Nema važeću pozitivnu stavku aktivnog MP cenovnika",
      "Ova boja porodice nije uključena za web",
    ]);
  });

  it("does not treat ordinary zero stock as a publication blocker", () => {
    process.env.ENFORCE_WEB_AUTO_AVAILABILITY = "false";
    expect(
      storefrontPublicationBlockers({
        isActive: true,
        availableWebManual: true,
        availableWebAuto: false,
        supplier: { integrationKey: null, enabled: true },
        hasActiveRetailPrice: true,
        familyStorefrontEnabled: null,
      }),
    ).toEqual([]);
  });
});
