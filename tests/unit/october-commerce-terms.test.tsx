import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { commerceTermsAt, OCTOBER_TERMS_AT_MS, scheduledDeliveryPromoText, scheduledDeliveryTermsMarkdown } from "@/lib/commerce-terms";
import { calculatePublishedDeliveryTariff, freeCategoryOneThresholdRsd } from "@/lib/delivery-tariff";
import { computeOrderPricing } from "@/lib/pricing/engine";
import { calculateEditedWebOrderTotals } from "@/lib/admin/web-order-edit";
import { computeTotals } from "@/components/checkout/order-summary";
import { CommerceTermsProvider, useCommerceTerms } from "@/components/pricing/commerce-terms-provider";
import { HeroCarousel } from "@/components/home/hero-carousel";
import { EditorialBanner } from "@/components/home/editorial-banner";

const before = new Date("2026-09-30T21:59:59.999Z");
const after = new Date("2026-09-30T22:00:00.000Z");
const parcel = { qty: 1, unitPrice: 4_000, unitPackWidthCm: 50, unitPackDepthCm: 40, unitPackHeightCm: 30, grossWeightKg: 2 };
const lines = [{ sku: "TEST", qty: 1, product: { fullPrice: 10_000, loyaltyDiscountPct: 30, loyaltyEligible: true } }];
afterEach(() => vi.useRealTimers());

describe("October terms at midnight in Serbia", () => {
  it("switches at midnight local time, not UTC midnight or deployment time", () => {
    expect(OCTOBER_TERMS_AT_MS).toBe(after.getTime());
    expect(commerceTermsAt(before)).toMatchObject({ firstPurchasePct: 15, guestFirstPurchaseAllowed: true, freeCategoryOneThresholdRsd: 4_000 });
    expect(commerceTermsAt(after)).toMatchObject({ firstPurchasePct: 10, guestFirstPurchaseAllowed: false, freeCategoryOneThresholdRsd: 20_000 });
    expect(freeCategoryOneThresholdRsd(before)).toBe(4_000);
    expect(freeCategoryOneThresholdRsd(after)).toBe(20_000);
  });

  it.each([false, true])("changes delivery for guest/member=%s and keeps category II payable", (loggedIn) => {
    const options = { loggedIn, at: after };
    expect(calculatePublishedDeliveryTariff([parcel], { loggedIn, at: before })?.total).toBe(0);
    expect(calculatePublishedDeliveryTariff([parcel], options)?.total).toBe(299);
    expect(calculatePublishedDeliveryTariff([{ ...parcel, unitPrice: 19_999.99 }], options)?.total).toBe(299);
    expect(calculatePublishedDeliveryTariff([{ ...parcel, unitPrice: 20_000 }], options)?.total).toBe(0);
    const mixed = calculatePublishedDeliveryTariff([
      { ...parcel, unitPrice: 20_000 },
      { ...parcel, unitPrice: 50_000, unitPackWidthCm: 170 },
    ], options);
    expect(mixed?.categories[1].price).toBe(0);
    expect(mixed?.categories[2].price).toBe(699);
    expect(mixed?.total).toBe(699);
  });

  it("switches server and client totals without restarting while retaining the 30% loyalty price", () => {
    vi.useFakeTimers();
    for (const [at, discount, total] of [[before, 1050, 6450], [after, 700, 6800]] as const) {
      vi.setSystemTime(at);
      const server = computeOrderPricing({ lines, eligibility: { firstPurchase: true } });
      expect(server.subtotal).toBe(7_000);
      expect(server.firstPurchaseDiscount).toBe(discount);
      const client = computeTotals({ itemsFull: 10_000, itemsSale: 7_000, shippingMethod: "kurir",
        assemblyTotal: 0, voucherDiscountRsd: 0, firstPurchaseEligible: true, shippingPrices: { kurir: 500, kamion: null } });
      expect(client.firstPurchaseDiscount).toBe(discount);
      expect(client.total).toBe(total);
      expect(computeOrderPricing({ lines, eligibility: { firstPurchase: false } }).firstPurchaseDiscount).toBe(0);
    }
  });

  it("preserves the original order's discount when an admin edits it after the change", () => {
    vi.useFakeTimers(); vi.setSystemTime(after);
    const input = { lines: [{ qty: 2, unitPriceFull: 5_000, unitPriceSale: 3_500 }], shipping: 500, keepFirstPurchaseDiscount: true };
    expect(calculateEditedWebOrderTotals({ ...input, orderCreatedAt: before }).firstPurchaseDiscount).toBe(1050);
    expect(calculateEditedWebOrderTotals({ ...input, orderCreatedAt: after }).firstPurchaseDiscount).toBe(700);
  });

  it("uses the serialized terms for consistent SSR and updates only the September delivery campaign", () => {
    function Label() { return <span>{useCommerceTerms().firstPurchasePct}%</span>; }
    expect(renderToStaticMarkup(<CommerceTermsProvider initialAt={before.getTime()}><Label /></CommerceTermsProvider>)).toBe("<span>15%</span>");
    expect(renderToStaticMarkup(<CommerceTermsProvider initialAt={after.getTime()}><Label /></CommerceTermsProvider>)).toBe("<span>10%</span>");
    const oldPromo = "OVOG SEPTEMBRA DOSTAVU PLAĆAMO MI! Besplatna isporuka preko 4.000 RSD za standardne pakete!*";
    expect(scheduledDeliveryPromoText(oldPromo, before)).toBe(oldPromo);
    expect(scheduledDeliveryPromoText(oldPromo, after)).toBe("Besplatna dostava od 20.000 RSD za standardne pakete (I kategorija).");
    expect(scheduledDeliveryPromoText("Akcija na stolice", after)).toBe("Akcija na stolice");
  });

  it("replaces the old image advertising 15% and hides the September delivery image at the same boundary", () => {
    const banner = { id: "old-first-purchase", title: " ", imageDesktop: { url: "/1787933740542-7b9a9155566c9637-desktop.webp" }, order: 1 };
    const hero = (at: Date) => renderToStaticMarkup(<CommerceTermsProvider initialAt={at.getTime()}><HeroCarousel banners={[banner]} /></CommerceTermsProvider>);
    expect(hero(before)).toContain(banner.imageDesktop.url.slice(1));
    expect(hero(after)).not.toContain(banner.imageDesktop.url.slice(1));
    expect(hero(after)).toContain("10");
    expect(hero(after)).toContain("Popusta za nove kupce");
    expect(hero(after)).toContain("preko prijavljenog naloga na sajtu");
    const delivery = { ...banner, id: "old-delivery", imageDesktop: { url: "/1788249570385-84e358deb7361629-desktop.webp" } };
    const editorial = (at: Date) => renderToStaticMarkup(<CommerceTermsProvider initialAt={at.getTime()}><EditorialBanner banner={delivery} /></CommerceTermsProvider>);
    expect(editorial(before)).toContain(delivery.imageDesktop.url.slice(1));
    expect(editorial(after)).toBe("");
  });

  it("updates only the obsolete published delivery paragraph, retaining the rest of the CMS page", () => {
    const prefix = "## Cena isporuke\n**";
    const suffix = "**\n## Pri prijemu\nSačuvan sadržaj.";
    const original = prefix + "Od 1. septembra 2026., dostava artikala I kategorije je besplatna kada njihov zbir iznosi 4.000 RSD ili više." + suffix;
    const updated = scheduledDeliveryTermsMarkdown(original);
    expect(updated).toContain("Od 1. oktobra 2026. u 00:00, po vremenu u Srbiji");
    expect(updated.startsWith(prefix)).toBe(true);
    expect(updated.endsWith(suffix)).toBe(true);
    expect(scheduledDeliveryTermsMarkdown(updated)).toBe(updated);
    expect(scheduledDeliveryTermsMarkdown("Budući tekst administratora.")).toBe("Budući tekst administratora.");
  });
});
