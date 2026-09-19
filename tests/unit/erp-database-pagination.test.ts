import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const modules = {
    dobavljaci: "supplier", "nabavne-cene": "purchasePrice", porudzbenice: "purchaseOrder",
    "porudzbenice-po-artiklima": "purchaseOrderItem", "ulazne-fakture": "inboundInvoice", "mp-cene": "product",
    "sifarnici-artikala": "productLookupValue", cenovnici: "priceList", akcije: "action", loyalty: "loyaltyRule",
    "linearne-promocije": "linearPromotion", magacini: "warehouse", otpremnice: "dispatchNote", preuzimanja: "pickupBatch",
    kupci: "customer", "partner-klijenti": "partnerApiClient", "partner-rezervacije": "partnerReservation",
    "racunovodstveni-registri": "fiscalDocument", "landing-strane": "landingPage", "landing-sekcije": "landingPageSection",
    "pozicije-piktograma": "pictogramPlacement", "newsletter-kampanje": "newsletterCampaign",
    "posete-konverzije": "analyticsEvent", "reklamacije-dnevnik": "reclamation", "admin-podesavanja": "adminSetting",
  };
  return { modules, db: Object.fromEntries(Object.values(modules).map((model) => [model, {
    count: vi.fn(), findMany: vi.fn(),
  }])) };
});
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/admin/pickup-batch.server", () => ({ getPickupPostingAvailability: vi.fn().mockResolvedValue({ available: true }) }));
import { getErpModule } from "@/lib/admin/erp";
import { countErpDatabaseRows, supportsErpDatabasePagination } from "@/lib/admin/erp-pagination";

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of Object.values(mocks.db)) {
    model.count.mockResolvedValue(250);
    model.findMany.mockResolvedValue([]);
  }
});

it.each(Object.entries(mocks.modules))("%s limits the correct database model before mapping rows", async (slug, model) => {
  expect(supportsErpDatabasePagination(slug)).toBe(true);
  await getErpModule(slug, { take: 100, skip: 100, includeLookupOptions: false });
  expect(mocks.db[model].findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100, skip: 100 }));
  const order = mocks.db[model].findMany.mock.calls[0][0].orderBy;
  expect(slug === "admin-podesavanja" ? order : order.at(-1)).toEqual(slug === "admin-podesavanja" ? { key: "asc" } : { id: "asc" });
  expect(await countErpDatabaseRows(slug)).toBe(250);
  if (slug === "otpremnice") {
    expect(mocks.db[model].findMany.mock.calls[0][0].where).toEqual(mocks.db[model].count.mock.calls[0][0].where);
  }
});

it.each(["prodajni-nalozi", "stanje-po-magacinima", "popisi", "neobjavljeni-artikli", "unknown", "toString"])("keeps transformed/unknown %s on the complete-result path", async (slug) => {
  expect(supportsErpDatabasePagination(slug)).toBe(false);
  expect(await countErpDatabaseRows(slug)).toBeNull();
});

it("does not issue row/count queries for a deferred sales grid", async () => {
  const erpModule = await getErpModule("prodajni-nalozi", { deferRows: true });
  expect(erpModule).toMatchObject({ rows: [], initialRowsPending: true, initialRowsComplete: false });
  expect(erpModule?.initialRowsTotal).toBeUndefined();
  for (const model of Object.values(mocks.db)) expect(model.findMany).not.toHaveBeenCalled();
});

it("reports a paginated first-page total without declaring the whole list complete", async () => {
  mocks.db.customer.findMany.mockResolvedValue(Array.from({ length: 100 }, (_, id) => ({ id: String(id), firstName: "Test" })));
  const erpModule = await getErpModule("kupci");
  expect(erpModule?.rows).toHaveLength(100);
  expect(erpModule).toMatchObject({ initialRowsTotal: 250, initialRowsComplete: false });
});
