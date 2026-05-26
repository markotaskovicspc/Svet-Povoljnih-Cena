import type { MediaAsset, Tab } from "@/types";

export type CampaignStickerKey = "action" | "new" | "under999" | "limited";
export type PromoTabIconKey =
  | "mesecna-akcija"
  | "nedeljna-akcija"
  | "heroji-meseca"
  | "niske-cene-pod-zastitom"
  | "ogranicena-ponuda"
  | "sve-do-999"
  | "specijalne-ponude";

export const actionCampaignSticker: MediaAsset = {
  url: "/brand/promo-stickers/akcija.svg",
  alt: "Akcija",
  width: 600,
  height: 600,
};

export const newCampaignSticker: MediaAsset = {
  url: "/brand/promo-stickers/novo.svg",
  alt: "Novo",
  width: 600,
  height: 600,
};

export const under999CampaignSticker: MediaAsset = {
  url: "/brand/promo-stickers/999.svg",
  alt: "Sve do 999",
  width: 1254,
  height: 1254,
};

export const limitedCampaignSticker: MediaAsset = {
  url: "/brand/promo-stickers/dtz2.svg",
  alt: "Dok traju zalihe",
  width: 1536,
  height: 1024,
};

export const campaignStickers: Record<CampaignStickerKey, MediaAsset> = {
  action: actionCampaignSticker,
  new: newCampaignSticker,
  under999: under999CampaignSticker,
  limited: limitedCampaignSticker,
};

export const herojiMesecaIcon: MediaAsset = {
  url: "/brand/heroji-meseca.png",
  alt: "Heroji meseca",
  width: 420,
  height: 360,
};

export const akcijaIcon = actionCampaignSticker;

export const protectedPricesIcon: MediaAsset = {
  url: "/brand/tnc-black.svg",
  alt: "Niske cene pod trajnom zaštitom",
  width: 1191,
  height: 895,
};

export const promoTabIcons: Partial<Record<PromoTabIconKey, MediaAsset>> = {
  "mesecna-akcija": akcijaIcon,
  "nedeljna-akcija": akcijaIcon,
  "heroji-meseca": herojiMesecaIcon,
  "niske-cene-pod-zastitom": protectedPricesIcon,
  "ogranicena-ponuda": limitedCampaignSticker,
  "sve-do-999": under999CampaignSticker,
  "specijalne-ponude": protectedPricesIcon,
};

export interface PromoTabPresentation extends Tab {
  iconAsset?: MediaAsset;
  iconKey?: PromoTabIconKey;
}

const promoTabKeyByHref: Record<string, PromoTabIconKey> = {
  "/akcija": "mesecna-akcija",
  "/nedeljna-akcija": "nedeljna-akcija",
  "/heroji-meseca": "heroji-meseca",
  "/niske-cene-pod-zastitom": "niske-cene-pod-zastitom",
  "/ogranicena-ponuda": "ogranicena-ponuda",
  "/sve-do-999": "sve-do-999",
  "/specijalne-ponude": "specijalne-ponude",
};

const promoTabKeyByLabel: Record<string, PromoTabIconKey> = {
  evonek: "heroji-meseca",
  "heroji meseca": "heroji-meseca",
  "mesecna akcija": "mesecna-akcija",
  "dok traju zalihe": "ogranicena-ponuda",
  "trajno niske cene": "niske-cene-pod-zastitom",
  "niske cene pod trajnom zastitom": "niske-cene-pod-zastitom",
  "sve do 999": "sve-do-999",
};

const canonicalPromoTabByKey: Partial<Record<PromoTabIconKey, Pick<Tab, "label" | "href">>> = {
  "heroji-meseca": { label: "Heroji meseca", href: "/heroji-meseca" },
};

function normalizePromoTabText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizePromoTabHref(value: string) {
  const path = value.split(/[?#]/)[0]?.replace(/\/+$/, "");
  return path || "/";
}

export function getPromoTabPresentation(tab: Tab): PromoTabPresentation {
  const hrefKey = promoTabKeyByHref[normalizePromoTabHref(tab.href)];
  const labelKey = promoTabKeyByLabel[normalizePromoTabText(tab.label)];
  const iconKey = hrefKey ?? labelKey ?? (tab.id as PromoTabIconKey);
  const canonical = canonicalPromoTabByKey[iconKey];

  return {
    ...tab,
    id: iconKey in promoTabIcons ? iconKey : tab.id,
    label: canonical?.label ?? tab.label,
    href: canonical?.href ?? tab.href,
    iconKey: iconKey in promoTabIcons ? iconKey : undefined,
    iconAsset: promoTabIcons[iconKey],
  };
}
