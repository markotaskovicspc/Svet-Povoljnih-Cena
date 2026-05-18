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
} from "@/lib/storefront/content";
import { listProducts } from "@/lib/api/catalog";
import { akcijaIcon, herojiMesecaIcon } from "@/data/campaign-icons";

export default async function Home() {
  const [banners, tabs, editorial, protectedBanner] = await Promise.all([
    getActiveBanners(),
    getActiveTabs(),
    getEditorialBanner(),
    getProtectedPricesBanner(),
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
        icon={herojiMesecaIcon}
        href="/heroji-meseca"
        products={heroes.items}
        minimalHeader
      />

      <ProtectedPricesBand banner={protectedBanner} />

      <SectionRail
        title="Mesečna akcija"
        icon={akcijaIcon}
        href="/akcija"
        products={monthly.items}
        minimalHeader
      />

      <EditorialBanner banner={editorial} />

      <SectionRail
        title="Nedeljna akcija"
        icon={akcijaIcon}
        href="/nedeljna-akcija"
        products={weekly.items}
        minimalHeader
      />

      {(
        await Promise.all(
          otherTabs.map(async (tab) => ({
            tab,
            list: await productsForTab(tab.href),
          })),
        )
      ).map(({ tab, list }) => {
        if (!list.length) return null;
        return (
          <SectionRail
            key={tab.id}
            title={tab.label}
            iconName={sectionIconName(tab.icon, tab.href)}
            href={tab.href}
            products={list}
            minimalHeader
          />
        );
      })}

      <UspStrip />
    </>
  );
}

const sectionIconByHref: Record<string, string> = {
  "/akcija": "Tag",
  "/nedeljna-akcija": "CalendarDays",
  "/heroji-meseca": "Crown",
  "/ogranicena-ponuda": "Hourglass",
  "/sve-do-999": "ShieldCheck",
  "/specijalne-ponude": "Sparkles",
  "/svet-akcija": "Rows3",
};

const supportedSectionIcons = new Set([
  "CalendarDays",
  "Crown",
  "Hourglass",
  "Rows3",
  "ShieldCheck",
  "Sparkles",
  "Tag",
]);

function sectionIconName(icon: string | undefined, href: string) {
  if (icon && supportedSectionIcons.has(icon)) return icon;
  return sectionIconByHref[href];
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
