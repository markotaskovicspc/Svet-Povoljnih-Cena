import type { MediaAsset } from "@/types";

export type CampaignStickerKey = "action" | "new" | "under999" | "limited";
export type PromoTabIconKey =
  | "mesecna-akcija"
  | "nedeljna-akcija"
  | "heroji-meseca"
  | "ogranicena-ponuda"
  | "sve-do-999"
  | "specijalne-ponude";

export const actionCampaignSticker: MediaAsset = {
  url: "/brand/promo-stickers/heroj-akcije.svg",
  alt: "Akcija",
  width: 4169,
  height: 3563,
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
  "ogranicena-ponuda": limitedCampaignSticker,
  "sve-do-999": under999CampaignSticker,
  "specijalne-ponude": akcijaIcon,
};
