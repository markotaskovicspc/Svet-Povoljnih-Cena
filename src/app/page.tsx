import { HeroCarousel } from "@/components/home/hero-carousel";
import { ShortcutStrip } from "@/components/home/shortcut-strip";
import { SectionRail } from "@/components/home/section-rail";
import { ProtectedPricesBand } from "@/components/home/protected-prices-band";
import { UspStrip } from "@/components/home/usp-strip";
import { getActiveBanners, getActiveTabs } from "@/lib/storefront/content";
import { getHomeLayout } from "@/lib/storefront/homepage";
import { HomeSectionSlotKey } from "@prisma/client";

export default async function Home() {
  const [banners, activeTabs, homeLayout] = await Promise.all([
    getActiveBanners(),
    getActiveTabs(),
    getHomeLayout(),
  ]);
  const { sections, bannerAfterSecond, bannerAfterFourth } = homeLayout;

  return (
    <>
      <HeroCarousel banners={banners} />
      <div className="md:hidden">
        <ShortcutStrip tabs={activeTabs} />
      </div>

      <HomeSection section={sections[HomeSectionSlotKey.FIRST]} />
      <HomeSection section={sections[HomeSectionSlotKey.SECOND]} />

      {bannerAfterSecond ? (
        <ProtectedPricesBand banner={bannerAfterSecond} compact />
      ) : null}

      <HomeSection section={sections[HomeSectionSlotKey.THIRD]} />
      <HomeSection section={sections[HomeSectionSlotKey.FOURTH]} />

      {bannerAfterFourth ? (
        <ProtectedPricesBand banner={bannerAfterFourth} compact />
      ) : null}

      <HomeSection section={sections[HomeSectionSlotKey.FIFTH]} />
      <HomeSection section={sections[HomeSectionSlotKey.SIXTH]} />

      <UspStrip />
    </>
  );
}

function HomeSection({
  section,
}: {
  section?: Awaited<ReturnType<typeof getHomeLayout>>["sections"][HomeSectionSlotKey];
}) {
  if (!section) return null;

  return (
    <SectionRail
      title={section.title}
      icon={section.icon}
      campaignSticker={section.campaignSticker}
      href={section.href}
      products={section.products}
      minimalHeader
      dense
    />
  );
}
