import { HeroCarousel } from "@/components/home/hero-carousel";
import { SectionRail } from "@/components/home/section-rail";
import { EditorialBanner } from "@/components/home/editorial-banner";
import { ProtectedPricesBand } from "@/components/home/protected-prices-band";
import { UspStrip } from "@/components/home/usp-strip";
import {
  getActiveBanners,
  getActiveTabs,
  getEditorialBanner,
  getProtectedPricesBanner,
  getSectionBanner,
} from "@/lib/storefront/content";
import { listProducts } from "@/lib/api/catalog";

export default async function Home() {
  const [banners, tabs, editorial, protectedBanner, heroSectionBanner, monthlyBanner, weeklyBanner] = await Promise.all([
    getActiveBanners(),
    getActiveTabs(),
    getEditorialBanner(),
    getProtectedPricesBanner(),
    getSectionBanner("heroji-meseca"),
    getSectionBanner("mesecna-akcija"),
    getSectionBanner("nedeljna-akcija"),
  ]);
  const [heroes, monthly, weekly] = await Promise.all([
    listProducts({ heroOnly: true, limit: 12 }),
    listProducts({ actionSlug: "akcija", limit: 12 }),
    listProducts({ actionSlug: "nedeljna-akcija", limit: 12 }),
  ]);

  // "Ostali tabovi" — tabs not already covered by the dedicated rails above.
  const coveredIds = new Set(["mesecna-akcija", "heroji-meseca", "nedeljna-akcija"]);
  const otherTabs = tabs.filter((t) => !coveredIds.has(t.id));

  return (
    <>
      <HeroCarousel banners={banners} />

      <SectionRail
        title="Heroji meseca"
        href="/heroji-meseca"
        products={heroes.items}
        banner={heroSectionBanner}
        mobileMinimal
      />

      <ProtectedPricesBand banner={protectedBanner} />

      <SectionRail
        eyebrow="Aktivna akcija"
        title="Mesečna akcija"
        description="Kuratirana selekcija sa popustima do 30%. Akcija traje do kraja meseca."
        href="/akcija"
        products={monthly.items}
        banner={monthlyBanner}
        mobileMinimal
      />

      <EditorialBanner banner={editorial} />

      <SectionRail
        eyebrow="Sedam dana"
        title="Nedeljna akcija"
        description="Brze ponude koje se menjaju svake nedelje. Iskoristi dok traju."
        href="/nedeljna-akcija"
        products={weekly.items}
        banner={weeklyBanner}
        mobileMinimal
      />

      {(
        await Promise.all(
          otherTabs.map(async (tab) => ({
            tab,
            list: await productsForTab(tab.href),
            banner: await getSectionBanner(tab.id),
          })),
        )
      ).map(({ tab, list, banner }) => {
        if (!list.length) return null;
        return (
          <SectionRail
            key={tab.id}
            title={tab.label}
            href={tab.href}
            products={list}
            banner={banner}
            mobileMinimal
          />
        );
      })}

      <UspStrip />
    </>
  );
}

async function productsForTab(href: string) {
  if (href === "/novo") return (await listProducts({ newOnly: true, limit: 12 })).items;
  if (href === "/outlet") return (await listProducts({ outletOnly: true, limit: 12 })).items;
  if (href === "/nedeljna-akcija") {
    return (await listProducts({ actionSlug: "nedeljna-akcija", limit: 12 })).items;
  }
  if (href === "/heroji-meseca") return (await listProducts({ heroOnly: true, limit: 12 })).items;
  if (href === "/sve-do-999") return (await listProducts({ maxPrice: 999, limit: 12 })).items;
  if (href === "/ogranicena-ponuda") {
    return (await listProducts({ limitedOnly: true, limit: 12 })).items;
  }
  if (href.startsWith("/k/")) {
    return (await listProducts({ categoryPath: href.slice(2), limit: 12 })).items;
  }
  return [];
}
