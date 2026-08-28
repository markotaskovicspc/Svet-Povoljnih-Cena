import type { LandingPageStatus } from "@prisma/client";

type LandingPageDestination = {
  id: string;
  slug: string;
  title: string;
  status: LandingPageStatus;
};

const landingPageStatusLabel: Record<LandingPageStatus, string> = {
  DRAFT: "Nacrt",
  PUBLISHED: "Objavljeno",
  ARCHIVED: "Arhivirano",
};

export function landingPageDestinationHref(slug: string) {
  return `/ponuda/${encodeURIComponent(slug)}`;
}

export function landingPageSlugFromDestinationHref(href: string) {
  const prefix = "/ponuda/";
  if (!href.startsWith(prefix)) return null;

  const encodedSlug = href.slice(prefix.length).split(/[?#]/, 1)[0];
  if (!encodedSlug) return null;

  try {
    const slug = decodeURIComponent(encodedSlug);
    return slug && !slug.includes("/") ? slug : null;
  } catch {
    return null;
  }
}

export function landingPageNavigationOptions(
  pages: LandingPageDestination[],
) {
  return pages.map((page) => ({
    value: landingPageDestinationHref(page.slug),
    label: `Landing · ${page.title} (${landingPageStatusLabel[page.status]})`,
  }));
}
