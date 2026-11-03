import type { ReactNode } from "react";
import { PromoBar } from "@/components/layout/promo-bar";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { NewsletterBand } from "@/components/layout/newsletter-band";
import { FirstPurchaseCta } from "@/components/layout/first-purchase-cta";
import { MessengerContact } from "@/components/layout/messenger-contact";
import { ExitIntentOffer } from "@/components/marketing/exit-intent-offer";
import { CookieConsent } from "@/components/privacy/cookie-consent";
import { FirstPartyAnalytics } from "@/components/analytics/first-party-analytics";
import { getGa4MeasurementId } from "@/lib/analytics/config";
import { getMetaPixelId } from "@/lib/analytics/meta-ecommerce";
import { getActivePromoBar, getActiveTabs } from "@/lib/storefront/content";
import { getCategoryTree } from "@/lib/api/catalog";
import { getCmsFooterState } from "@/lib/cms/pages";
import { hasDatabaseConnection } from "@/lib/db";
import { primaryNav } from "@/data/site";
import { categoryNav } from "@/lib/storefront/category-navigation";
import { getMobileSearchContent } from "@/lib/mobile-search/server";
import { StorefrontStickyHeader } from "@/components/layout/storefront-sticky-header";

const gaId = getGa4MeasurementId();
const metaPixelId = getMetaPixelId();

/**
 * Shared public storefront shell.
 *
 * It intentionally contains no request-time APIs (headers, cookies or auth),
 * so anonymous catalog routes can be prerendered and served from the CDN.
 * Login and loyalty state are hydrated by the client session provider.
 */
export async function StorefrontShell({ children }: { children: ReactNode }) {
  const [activePromoBar, activeTabs, categoryTree, cmsFooter, mobileSearchContent] = await Promise.all([
    getActivePromoBar(),
    getActiveTabs(),
    getCategoryTree(),
    getCmsFooterState(),
    getMobileSearchContent(),
  ]);
  const categories = categoryTree.length
    ? categoryNav(categoryTree)
    : hasDatabaseConnection()
      ? []
      : primaryNav;

  return (
    <>
      <StorefrontStickyHeader>
        <div
          aria-hidden
          className="h-[max(env(safe-area-inset-top),1.5rem)] bg-white md:hidden"
        />
        {activePromoBar ? <PromoBar bar={activePromoBar} /> : null}
        <Header tabs={activeTabs} categories={categories} mobileSearchContent={mobileSearchContent} />
      </StorefrontStickyHeader>
      <main className="flex-1">{children}</main>
      <FirstPurchaseCta />
      <MessengerContact />
      <ExitIntentOffer />
      <NewsletterBand />
      <Footer cmsFooter={cmsFooter} />
      <CookieConsent gaId={gaId} metaPixelId={metaPixelId} />
      <FirstPartyAnalytics />
    </>
  );
}
