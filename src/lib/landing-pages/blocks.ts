import { z } from "zod";
import { isAllowedCmsHref, validateCmsMarkdown } from "@/lib/cms/markdown";

export const LANDING_PICTOGRAM_SLOTS = [
  "TOP_LEFT_1",
  "TOP_LEFT_2",
  "BOTTOM_RIGHT_1",
  "BOTTOM_RIGHT_2",
] as const;

export const LANDING_BLOCK_TYPES = [
  "RICH_TEXT",
  "BANNER",
  "PRODUCT_GRID",
  "PICTOGRAM_ROW",
  "CTA",
] as const;

export const LANDING_PAGE_TEMPLATES = [
  "BUILDER",
  "SIMPLE_PRODUCT_LIST",
] as const;
export type LandingPageTemplate = (typeof LANDING_PAGE_TEMPLATES)[number];

const optionalText = (max: number) => z.string().trim().max(max).nullable();
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const blockBase = {
  id: z.string().trim().min(1).max(80),
  visible: z.boolean().default(true),
};

function isAllowedMediaUrl(value: string) {
  if (!value) return true;
  if (/[/\\]\.\.(?:[/\\]|$)/.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const optionalMediaUrl = optionalText(2_000).refine(
  (value) => !value || isAllowedMediaUrl(value),
  "Slika mora imati bezbedan HTTPS ili interni URL.",
);
const optionalHref = optionalText(2_000).refine(
  (value) => !value || isAllowedCmsHref(value),
  "Link mora biti interni put, anchor, HTTPS, mailto ili tel URL.",
);
const requiredHref = requiredText(2_000).refine(
  isAllowedCmsHref,
  "Link mora biti interni put, anchor, HTTPS, mailto ili tel URL.",
);

export const richTextBlockSchema = z.object({
  ...blockBase,
  type: z.literal("RICH_TEXT"),
  title: optionalText(160),
  bodyMarkdown: z.string().max(60_000),
});

export const bannerBlockSchema = z.object({
  ...blockBase,
  type: z.literal("BANNER"),
  eyebrow: optionalText(80),
  title: requiredText(160),
  body: optionalText(2_000),
  imageDesktopUrl: optionalMediaUrl,
  imageMobileUrl: optionalMediaUrl,
  imageAlt: optionalText(240),
  ctaLabel: optionalText(80),
  ctaHref: optionalHref,
  theme: z.enum(["LIGHT", "DARK"]).default("LIGHT"),
});

export const productGridBlockSchema = z.object({
  ...blockBase,
  type: z.literal("PRODUCT_GRID"),
  title: optionalText(160),
  body: optionalText(1_000),
  productSkus: z.array(z.string().trim().min(1).max(120)).max(50),
});

export const pictogramRowBlockSchema = z.object({
  ...blockBase,
  type: z.literal("PICTOGRAM_ROW"),
  title: optionalText(160),
  items: z
    .array(
      z.object({
        pictogramId: z.string().trim().min(1).max(120),
        label: optionalText(120),
        href: optionalHref,
      }),
    )
    .max(8),
});

export const ctaBlockSchema = z.object({
  ...blockBase,
  type: z.literal("CTA"),
  title: requiredText(160),
  body: optionalText(1_000),
  ctaLabel: requiredText(80),
  ctaHref: requiredHref,
  theme: z.enum(["LIGHT", "DARK"]).default("DARK"),
});

export const landingBlockSchema = z.discriminatedUnion("type", [
  richTextBlockSchema,
  bannerBlockSchema,
  productGridBlockSchema,
  pictogramRowBlockSchema,
  ctaBlockSchema,
]);

export const landingBlocksSchema = z.array(landingBlockSchema).max(40);

export type LandingBlock = z.infer<typeof landingBlockSchema>;
export type LandingBlockType = LandingBlock["type"];

export const heroPictogramsSchema = z.object({
  TOP_LEFT_1: z.string().trim().nullable(),
  TOP_LEFT_2: z.string().trim().nullable(),
  BOTTOM_RIGHT_1: z.string().trim().nullable(),
  BOTTOM_RIGHT_2: z.string().trim().nullable(),
});
export type LandingHeroPictograms = z.infer<typeof heroPictogramsSchema>;

export const EMPTY_HERO_PICTOGRAMS: LandingHeroPictograms = {
  TOP_LEFT_1: null,
  TOP_LEFT_2: null,
  BOTTOM_RIGHT_1: null,
  BOTTOM_RIGHT_2: null,
};

export const landingSnapshotSchema = z.object({
  template: z.enum(LANDING_PAGE_TEMPLATES).default("BUILDER"),
  legacySectionsFallback: z.boolean().default(false),
  title: requiredText(160),
  lead: optionalText(1_000),
  heroImageUrl: optionalMediaUrl,
  heroMobileImageUrl: optionalMediaUrl,
  heroImageAlt: optionalText(240),
  heroCtaLabel: optionalText(80),
  heroCtaHref: optionalHref,
  heroPictograms: heroPictogramsSchema.default(EMPTY_HERO_PICTOGRAMS),
  blocks: landingBlocksSchema,
  productSkus: z.array(z.string().trim().min(1).max(120)).default([]),
  seoTitle: optionalText(160),
  seoDescription: optionalText(500),
  ogImageUrl: optionalMediaUrl,
  canonicalUrl: optionalHref,
  robotsIndex: z.boolean(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
});

export type LandingPageSnapshot = z.infer<typeof landingSnapshotSchema>;

export function parseLandingBlocks(value: unknown): LandingBlock[] {
  const parsed = landingBlocksSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function parseLandingSnapshot(value: unknown) {
  return landingSnapshotSchema.safeParse(value);
}

export function validateLandingBlocksForPublish(blocks: LandingBlock[]) {
  const messages: string[] = [];
  const ids = new Set<string>();
  for (const [index, block] of blocks.entries()) {
    if (ids.has(block.id)) messages.push(`Blok ${index + 1} ima dupliran ID.`);
    ids.add(block.id);
    if (!block.visible) continue;
    if (block.type === "RICH_TEXT") {
      messages.push(...validateCmsMarkdown(block.bodyMarkdown).map((issue) => issue.message));
    }
    if (block.type === "PRODUCT_GRID" && block.productSkus.length === 0) {
      messages.push(`Blok „${block.title || "Proizvodi"}” nema izabrane artikle.`);
    }
    if (block.type === "PICTOGRAM_ROW" && block.items.length === 0) {
      messages.push(`Blok „${block.title || "Piktogrami"}” nema izabrane piktograme.`);
    }
    if (
      (block.type === "BANNER" || block.type === "CTA") &&
      Boolean(block.ctaLabel) !== Boolean(block.ctaHref)
    ) {
      messages.push(`Blok „${block.title}” mora imati i naziv i link dugmeta.`);
    }
  }
  return messages;
}

export function newLandingBlock(type: LandingBlockType): LandingBlock {
  const id = globalThis.crypto?.randomUUID?.() ?? `${type.toLowerCase()}-${Date.now()}`;
  if (type === "RICH_TEXT") {
    return { id, type, visible: true, title: null, bodyMarkdown: "## Novi sadržaj\n\nUnesite tekst." };
  }
  if (type === "BANNER") {
    return {
      id, type, visible: true, eyebrow: null, title: "Novi baner", body: null,
      imageDesktopUrl: null, imageMobileUrl: null, imageAlt: null,
      ctaLabel: null, ctaHref: null, theme: "LIGHT",
    };
  }
  if (type === "PRODUCT_GRID") {
    return { id, type, visible: true, title: "Izdvojeni proizvodi", body: null, productSkus: [] };
  }
  if (type === "PICTOGRAM_ROW") {
    return { id, type, visible: true, title: "Zašto da izaberete nas", items: [] };
  }
  return {
    id, type: "CTA", visible: true, title: "Pogledajte celu ponudu", body: null,
    ctaLabel: "Pogledajte ponudu", ctaHref: "/", theme: "DARK",
  };
}

export function legacySectionsToBlocks(
  sections: Array<{
    id: string;
    title: string | null;
    body: string | null;
    imageUrl: string | null;
    productSkus: string[];
  }>,
): LandingBlock[] {
  return sections.flatMap((section) => {
    const blocks: LandingBlock[] = [];
    if (section.title || section.body || section.imageUrl) {
      blocks.push({
        id: `legacy-banner-${section.id}`,
        type: "BANNER",
        visible: true,
        eyebrow: null,
        title: section.title || "Ponuda",
        body: section.body,
        imageDesktopUrl: section.imageUrl,
        imageMobileUrl: null,
        imageAlt: section.title,
        ctaLabel: null,
        ctaHref: null,
        theme: "LIGHT",
      });
    }
    if (section.productSkus.length) {
      blocks.push({
        id: `legacy-products-${section.id}`,
        type: "PRODUCT_GRID",
        visible: true,
        title: section.title,
        body: null,
        productSkus: section.productSkus,
      });
    }
    return blocks;
  });
}
