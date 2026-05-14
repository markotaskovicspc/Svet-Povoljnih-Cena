import { HeroCarousel } from "@/components/home/hero-carousel";
import { SectionRail } from "@/components/home/section-rail";
import { EditorialBanner } from "@/components/home/editorial-banner";
import { ProtectedPricesBand } from "@/components/home/protected-prices-band";
import { UspStrip } from "@/components/home/usp-strip";
import {
  getActiveBanners,
  getActiveTabs,
  getEditorialBanner,
} from "@/lib/storefront/content";
import {
  heroesOfTheMonth,
  monthlyAction,
  weeklyAction,
  productsForTab,
} from "@/data/products";

export default async function Home() {
  const [banners, tabs, editorial] = await Promise.all([
    getActiveBanners(),
    getActiveTabs(),
    getEditorialBanner(),
  ]);
  const heroes = heroesOfTheMonth();
  const monthly = monthlyAction();
  const weekly = weeklyAction();

  // "Ostali tabovi" — tabs not already covered by the dedicated rails above.
  const coveredIds = new Set(["mesecna-akcija", "heroji-meseca", "nedeljna-akcija"]);
  const otherTabs = tabs.filter((t) => !coveredIds.has(t.id));

  return (
    <>
      <HeroCarousel banners={banners} />

      <SectionRail
        eyebrow="Selekcija meseca"
        title="Heroji meseca"
        description="Komadi koje preporučujemo — najbolji odnos cene i kvaliteta u tekućem mesecu."
        href="/heroji-meseca"
        products={heroes}
        mobileMinimal
      />

      <ProtectedPricesBand />

      <SectionRail
        eyebrow="Aktivna akcija"
        title="Mesečna akcija"
        description="Kuratirana selekcija sa popustima do 30%. Akcija traje do kraja meseca."
        href="/akcija"
        products={monthly}
      />

      <EditorialBanner banner={editorial} />

      <SectionRail
        eyebrow="Sedam dana"
        title="Nedeljne akcije"
        description="Brze ponude koje se menjaju svake nedelje. Iskoristi dok traju."
        href="/nedeljna-akcija"
        products={weekly}
      />

      {otherTabs.map((tab) => {
        const list = productsForTab(tab.id);
        if (!list.length) return null;
        return (
          <SectionRail
            key={tab.id}
            eyebrow="Tabovi"
            title={tab.label}
            href={tab.href}
            products={list}
          />
        );
      })}

      <UspStrip />
    </>
  );
}
