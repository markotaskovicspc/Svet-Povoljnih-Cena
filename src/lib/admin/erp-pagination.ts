import { db } from "@/lib/db";

// Only builders with exactly one output row per selected record and matching
// predicates are eligible. Computed/merged lists keep their existing full query.
const counters: Record<string, () => Promise<number>> = {
  dobavljaci: () => db.supplier.count(),
  "nabavne-cene": () => db.purchasePrice.count(),
  porudzbenice: () => db.purchaseOrder.count(),
  "porudzbenice-po-artiklima": () => db.purchaseOrderItem.count(),
  "ulazne-fakture": () => db.inboundInvoice.count(),
  "mp-cene": () => db.product.count(),
  "sifarnici-artikala": () => db.productLookupValue.count(),
  cenovnici: () => db.priceList.count(),
  akcije: () => db.action.count(),
  loyalty: () => db.loyaltyRule.count(),
  "linearne-promocije": () => db.linearPromotion.count(),
  magacini: () => db.warehouse.count(),
  otpremnice: () => db.dispatchNote.count({ where: { type: { in: ["CUSTOMER", "INTERNAL"] } } }),
  preuzimanja: () => db.pickupBatch.count(),
  kupci: () => db.customer.count(),
  "partner-klijenti": () => db.partnerApiClient.count(),
  "partner-rezervacije": () => db.partnerReservation.count(),
  "racunovodstveni-registri": () => db.fiscalDocument.count(),
  "landing-strane": () => db.landingPage.count(),
  "landing-sekcije": () => db.landingPageSection.count(),
  "pozicije-piktograma": () => db.pictogramPlacement.count(),
  "newsletter-kampanje": () => db.newsletterCampaign.count(),
  "posete-konverzije": () => db.analyticsEvent.count(),
  "reklamacije-dnevnik": () => db.reclamation.count(),
  "admin-podesavanja": () => db.adminSetting.count(),
};

export function supportsErpDatabasePagination(slug: string) {
  return Object.hasOwn(counters, slug);
}

export function countErpDatabaseRows(slug: string): Promise<number | null> {
  return supportsErpDatabasePagination(slug) ? counters[slug]() : Promise.resolve(null);
}
