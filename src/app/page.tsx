import { HeroCarousel } from "@/components/home/hero-carousel";
import { SectionRail } from "@/components/home/section-rail";
import { ProtectedPricesBand } from "@/components/home/protected-prices-band";
import { UspStrip } from "@/components/home/usp-strip";
import {
  getActiveBanners,
  getProtectedPricesBanner,
} from "@/lib/storefront/content";
import { listProducts } from "@/lib/api/catalog";
import {
  akcijaIcon,
  herojiMesecaIcon,
  under999CampaignSticker,
} from "@/data/campaign-icons";

export default async function Home() {
  const [banners, protectedBanner] = await Promise.all([
    getActiveBanners(),
    getProtectedPricesBanner(),
  ]);
  const [monthly, heroes, under999] = await Promise.all([
    listProducts({ actionSlug: "akcija", limit: 12 }),
    listProducts({ heroOnly: true, limit: 12 }),
    listProducts({ maxPrice: 999, limit: 12 }),
  ]);

  return (
    <>
      <HeroCarousel banners={banners} />

      <SectionRail
        title="Mesečna akcija"
        icon={akcijaIcon}
        campaignSticker="action"
        href="/akcija"
        products={monthly.items}
        minimalHeader
      />

      <SectionRail
        title="Heroji meseca"
        icon={herojiMesecaIcon}
        href="/heroji-meseca"
        products={heroes.items}
        minimalHeader
      />

      <ProtectedPricesBand banner={protectedBanner} />

      <SectionRail
        title="Sve do 999"
        icon={under999CampaignSticker}
        campaignSticker="under999"
        href="/sve-do-999"
        products={under999.items}
        minimalHeader
      />

      <UspStrip />
    </>
  );
}
