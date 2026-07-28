import "server-only";

import { ActionKind, LandingPageStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { LANDING_PAGE_OPTIONS } from "@/lib/storefront/homepage";
import {
  normalizeMobileShortcutHref,
  parseMobileShortcutDestination,
} from "@/lib/mobile-shortcuts/shared";

type ActionDestination = {
  id: string;
  slug: string;
  kind: ActionKind;
  startsAt?: Date;
  endsAt?: Date;
};

type LandingDestination = {
  id: string;
  slug: string;
  status?: LandingPageStatus;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export type MobileTabForHref = {
  href: string | null;
  action: Pick<ActionDestination, "slug" | "kind"> | null;
  landingPage: Pick<LandingDestination, "slug"> | null;
};

const ACTION_KIND_PATH: Record<Exclude<ActionKind, "CUSTOM">, string> = {
  AKCIJA: "/akcija",
  NEDELJNA: "/nedeljna-akcija",
  HEROJI: "/heroji-meseca",
  OGRANICENA: "/ogranicena-ponuda",
  OUTLET: "/outlet",
};

const STATIC_STOREFRONT_PATHS = new Set([
  "/",
  "/kontakt",
  "/novo",
  "/outlet",
  "/pretraga",
  "/servis",
  "/svet-akcija",
  "/o-nama",
  "/pomoc",
  "/reklamacije",
  "/uslovi-isporuke",
  "/uslovi-koriscenja",
  "/uslovi-kupovine",
  "/politika-privatnosti",
  ...LANDING_PAGE_OPTIONS.map((page) => page.href),
]);

export function resolveActionMobileHref(
  action: Pick<ActionDestination, "slug" | "kind">,
) {
  return action.kind === ActionKind.CUSTOM
    ? `/pretraga?actionSlug=${encodeURIComponent(action.slug)}`
    : ACTION_KIND_PATH[action.kind];
}

export function resolveMobileTabHref(tab: MobileTabForHref) {
  if (tab.action) return resolveActionMobileHref(tab.action);
  if (tab.landingPage) return `/ponuda/${encodeURIComponent(tab.landingPage.slug)}`;
  return tab.href ? normalizeMobileShortcutHref(tab.href) : null;
}

function isLandingCurrentlyPublished(
  landing: Pick<LandingDestination, "status" | "startsAt" | "endsAt">,
  now = new Date(),
) {
  return (
    landing.status === LandingPageStatus.PUBLISHED &&
    (!landing.startsAt || landing.startsAt <= now) &&
    (!landing.endsAt || landing.endsAt >= now)
  );
}

async function validateInternalHref(href: string, enabled: boolean) {
  const parsed = new URL(href, "https://www.svetpovoljnihcena.rs");
  const path = parsed.pathname.replace(/\/$/, "") || "/";
  if (STATIC_STOREFRONT_PATHS.has(path)) return;

  if (path.startsWith("/k/")) {
    const categoryPath = path.slice(2);
    const category = await db.category.findUnique({
      where: { path: categoryPath },
      select: { id: true },
    });
    if (!category) throw new Error("Izabrana kategorija ne postoji.");
    return;
  }

  if (path.startsWith("/p/")) {
    const slug = decodeURIComponent(path.slice(3));
    const product = await db.product.findFirst({
      where: { slug, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new Error("Izabrani proizvod nije aktivan ili ne postoji.");
    return;
  }

  if (path.startsWith("/ponuda/")) {
    const slug = decodeURIComponent(path.slice("/ponuda/".length));
    const landing = await db.landingPage.findUnique({
      where: { slug },
      select: { id: true, status: true, startsAt: true, endsAt: true },
    });
    if (!landing) throw new Error("Izabrana landing strana ne postoji.");
    if (enabled && !isLandingCurrentlyPublished(landing)) {
      throw new Error("Aktivan prečac može da vodi samo na trenutno objavljenu landing stranu.");
    }
    return;
  }

  throw new Error("Interni link nije pronađen. Izaberite postojeću stranicu ili kategoriju.");
}

export type ResolvedMobileTabDestination = {
  data: Pick<
    Prisma.MobileTabUncheckedCreateInput,
    "actionId" | "landingPageId" | "href"
  >;
  href: string;
};

export async function resolveMobileTabDestination(input: {
  selection: string | null | undefined;
  customHref: string | null | undefined;
  enabled: boolean;
}): Promise<ResolvedMobileTabDestination> {
  const customHref = input.customHref?.trim();
  const parsed = parseMobileShortcutDestination(
    customHref ? `href:${customHref}` : input.selection,
  );
  if (!parsed) throw new Error("Izaberite odredište ili unesite prilagođeni link.");

  if (parsed.kind === "action") {
    const action = await db.action.findUnique({
      where: { id: parsed.value },
      select: { id: true, slug: true, kind: true, startsAt: true, endsAt: true },
    });
    if (!action) throw new Error("Izabrana akcija više ne postoji.");
    const now = new Date();
    if (input.enabled && (action.startsAt > now || action.endsAt < now)) {
      throw new Error("Aktivan prečac može da vodi samo na trenutno važeću akciju.");
    }
    return {
      data: { actionId: action.id, landingPageId: null, href: null },
      href: resolveActionMobileHref(action),
    };
  }

  if (parsed.kind === "landing") {
    const landing = await db.landingPage.findUnique({
      where: { id: parsed.value },
      select: { id: true, slug: true, status: true, startsAt: true, endsAt: true },
    });
    if (!landing) throw new Error("Izabrana landing strana više ne postoji.");
    if (input.enabled && !isLandingCurrentlyPublished(landing)) {
      throw new Error("Aktivan prečac može da vodi samo na trenutno objavljenu landing stranu.");
    }
    return {
      data: { actionId: null, landingPageId: landing.id, href: null },
      href: `/ponuda/${encodeURIComponent(landing.slug)}`,
    };
  }

  const href = normalizeMobileShortcutHref(parsed.value);
  if (href.startsWith("/")) await validateInternalHref(href, input.enabled);
  return {
    data: { actionId: null, landingPageId: null, href },
    href,
  };
}

export function landingPageIsLive(
  landing: Pick<LandingDestination, "status" | "startsAt" | "endsAt">,
) {
  return isLandingCurrentlyPublished(landing);
}
