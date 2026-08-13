import type { ReactNode } from "react";
import { PromoBar } from "@/components/layout/promo-bar";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { NewsletterBand } from "@/components/layout/newsletter-band";
import { FirstPurchaseCta } from "@/components/layout/first-purchase-cta";
import { CookieConsent } from "@/components/privacy/cookie-consent";
import { FirstPartyAnalytics } from "@/components/analytics/first-party-analytics";
import { getGa4MeasurementId } from "@/lib/analytics/config";
import { getActivePromoBar, getActiveTabs } from "@/lib/storefront/content";
import { getCategoryTree, type CategoryNode } from "@/lib/api/catalog";
import { getCmsFooterState } from "@/lib/cms/pages";
import { primaryNav, type NavNode } from "@/data/site";
import { getMobileSearchContent } from "@/lib/mobile-search/server";

const gaId = getGa4MeasurementId();

function categoryNav(
  nodes: CategoryNode[],
  parentSegments: string[] = [],
): NavNode[] {
  return nodes.map((node) => {
    const segments = [...parentSegments, node.slug];
    return {
      label: node.name,
      href: `/k/${segments.join("/")}`,
      imageUrl: node.imageUrl,
      children: node.children.length
        ? categoryNav(node.children, segments)
        : undefined,
    };
  });
}

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
    : primaryNav;

  return (
    <>
      <div className="sticky top-0 z-50 bg-white">
        <div
          aria-hidden
          className="h-[max(env(safe-area-inset-top),1.5rem)] bg-white md:hidden"
        />
        {activePromoBar ? <PromoBar bar={activePromoBar} /> : null}
        <Header tabs={activeTabs} categories={categories} mobileSearchContent={mobileSearchContent} />
      </div>
      <main className="flex-1">{children}</main>
      <FirstPurchaseCta />
      <NewsletterBand />
      <Footer cmsFooter={cmsFooter} />
      <CookieConsent gaId={gaId} />
      <FirstPartyAnalytics />
    </>
  );
}
