import { HeroCarousel } from "@/components/home/hero-carousel";
import { ShortcutStrip } from "@/components/home/shortcut-strip";
import { SectionRail } from "@/components/home/section-rail";
import { EditorialBanner } from "@/components/home/editorial-banner";
import { UspStrip } from "@/components/home/usp-strip";
import {
  getActiveBanners,
  getActiveMobileTabs,
} from "@/lib/storefront/content";
import { getHomeLayout } from "@/lib/storefront/homepage";
import { HomeSectionSlotKey } from "@prisma/client";
import { BRAND } from "@/lib/brand";

export const revalidate = 60;

const websiteStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: BRAND.name,
  alternateName: ["Svet povoljnih cena", "svetpovoljnihcena.rs"],
  url: `${BRAND.url}/`,
};

export default async function Home() {
  const [banners, mobileTabs, homeLayout] = await Promise.all([
    getActiveBanners(),
    getActiveMobileTabs(),
    getHomeLayout(),
  ]);
  const { sections, bannerAfterSecond, bannerAfterFourth } = homeLayout;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(websiteStructuredData).replace(/</g, "\\u003c"),
        }}
      />
      <h1 className="sr-only">
        Svet povoljnih cena — online prodavnica
      </h1>
      <HeroCarousel banners={banners} />
      <div className="md:hidden">
        <ShortcutStrip tabs={mobileTabs} />
      </div>

      <HomeSection section={sections[HomeSectionSlotKey.FIRST]} />
      <HomeSection section={sections[HomeSectionSlotKey.SECOND]} />

      {bannerAfterSecond ? (
        <EditorialBanner banner={bannerAfterSecond} compact />
      ) : null}

      <HomeSection section={sections[HomeSectionSlotKey.THIRD]} />
      <HomeSection section={sections[HomeSectionSlotKey.FOURTH]} />

      {bannerAfterFourth ? (
        <EditorialBanner banner={bannerAfterFourth} compact />
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
      compactCardsOnDesktop
      emptyMessage="Trenutno nema dostupnih proizvoda u ovoj sekciji."
    />
  );
}
