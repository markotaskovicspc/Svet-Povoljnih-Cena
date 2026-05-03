import { HeroCarousel } from "@/components/home/hero-carousel";
import { TabsStrip } from "@/components/home/tabs-strip";
import { SectionRail } from "@/components/home/section-rail";
import { EditorialBanner } from "@/components/home/editorial-banner";
import { UspStrip } from "@/components/home/usp-strip";
import { headerTabs } from "@/data/site";
import { heroBanners, editorialBanner } from "@/data/banners";
import {
  heroesOfTheMonth,
  monthlyAction,
  weeklyAction,
  productsForTab,
} from "@/data/products";

export default function Home() {
  const heroes = heroesOfTheMonth();
  const monthly = monthlyAction();
  const weekly = weeklyAction();

  // "Ostali tabovi" — tabs not already covered by the dedicated rails above.
  const coveredIds = new Set(["heroji-meseca", "nedeljna-akcija"]);
  const otherTabs = headerTabs.filter((t) => !coveredIds.has(t.id));

  return (
    <>
      <HeroCarousel banners={heroBanners} />
      <TabsStrip tabs={headerTabs} />

      <SectionRail
        eyebrow="Selekcija meseca"
        title="Heroji meseca"
        description="Komadi koje preporučujemo — najbolji odnos cene i kvaliteta u tekućem mesecu."
        href="/heroji-meseca"
        products={heroes}
        mobileMinimal
      />

      <SectionRail
        eyebrow="Aktivna akcija"
        title="Mesečna akcija"
        description="Kuratirana selekcija sa popustima do 30%. Akcija traje do kraja meseca."
        href="/akcija"
        products={monthly}
      />

      <EditorialBanner banner={editorialBanner} />

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
