import "server-only";

import { z } from "zod";
import { db } from "@/lib/db";
import { webStorefrontProductWhere } from "@/lib/web-storefront-availability";
import { BRAND } from "@/lib/brand";
import { formatRsd } from "@/lib/format";
import { formatProductDisplayName } from "@/lib/product-name";
import { resolveProductPriceQuote } from "@/lib/pricing/engine";
import {
  getActivePricingRules,
  pricingRuleInputsForProduct,
} from "@/lib/pricing/rules";
import {
  lowestPublicPriceLast30Days,
  resolveRetailPrice,
} from "@/lib/pricing/retail-price";

const requiredText = z.string().trim().min(1).max(4_000);
const optionalUrl = z.string().trim().max(2_000).refine(
  (value) => !value || safeUrl(value),
  "Link mora biti bezbedan http(s) ili interni link.",
);

export const newsletterBlockSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1), type: z.literal("heading"), text: requiredText.max(160) }),
  z.object({ id: z.string().min(1), type: z.literal("text"), text: requiredText }),
  z.object({
    id: z.string().min(1),
    type: z.literal("image"),
    url: optionalUrl.refine(Boolean, "URL slike je obavezan."),
    alt: z.string().trim().min(1).max(240),
    href: optionalUrl.optional().default(""),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("button"),
    label: requiredText.max(80),
    href: optionalUrl.refine(Boolean, "CTA link je obavezan."),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("products"),
    title: z.string().trim().max(160).optional().default(""),
    skus: z.array(z.string().trim().min(1).max(80)).min(1).max(6),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("voucher"),
    code: z.string().trim().min(1).max(40),
    text: z.string().trim().max(500).optional().default(""),
  }),
  z.object({ id: z.string().min(1), type: z.literal("divider") }),
]);

export const newsletterContentSchema = z.array(newsletterBlockSchema).max(40);
export type NewsletterBlock = z.infer<typeof newsletterBlockSchema>;

type RenderOptions = {
  subject: string;
  previewText?: string | null;
  content: unknown;
  unsubscribeUrl?: string;
  baseUrl?: string;
};

const EMAIL_COLORS = {
  blue: "#123F5A",
  blueSoft: "#EAF4F7",
  ink: "#172B36",
  muted: "#5F6F78",
  line: "#DCE6EA",
  page: "#F2F6F8",
  white: "#FFFFFF",
} as const;

export async function renderNewsletterCampaign(options: RenderOptions) {
  const blocks = newsletterContentSchema.parse(options.content);
  const baseUrl = options.baseUrl ?? BRAND.url;
  const productSkus = Array.from(
    new Set(
      blocks.flatMap((block) => block.type === "products" ? block.skus : []),
    ),
  );
  const [products, pricingRules] = productSkus.length
    ? await Promise.all([
      db.product.findMany({
        where: {
          sku: { in: productSkus },
          deletedAt: null,
          ...webStorefrontProductWhere(),
        },
        select: {
          sku: true,
          slug: true,
          name: true,
          shortName: true,
          sizeLabel: true,
          fullPrice: true,
          salePrice: true,
          action: true,
          actionPrices: { include: { action: true } },
          priceListEntries: {
            where: { priceList: { active: true, kind: "RETAIL" } },
            include: { priceList: true },
            orderBy: { validFrom: "desc" },
          },
          groupId: true,
          categories: {
            select: {
              categoryId: true,
              category: { select: { path: true } },
            },
          },
          media: {
            where: { kind: "IMAGE", syncStatus: "READY" },
            orderBy: { order: "asc" },
            take: 1,
            select: { url: true, cardUrl: true, alt: true },
          },
        },
      }),
      getActivePricingRules(),
    ])
    : [[], null] as const;
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const pricesBySku = new Map(products.map((product) => {
    if (!pricingRules) return [product.sku, null] as const;
    const evaluatedAt = new Date(pricingRules.evaluatedAt);
    const retailPrice = resolveRetailPrice(
      product.priceListEntries,
      product.fullPrice,
      evaluatedAt,
    );
    const referencePrice = lowestPublicPriceLast30Days(
      product.priceListEntries,
      product.actionPrices,
      retailPrice.price,
      evaluatedAt,
    );
    const ruleInputs = pricingRuleInputsForProduct(
      {
        groupId: product.groupId,
        categoryIds: product.categories.map((item) => item.categoryId),
        categoryPaths: product.categories.map((item) => item.category.path),
      },
      pricingRules,
    );
    const price = resolveProductPriceQuote(
      {
        fullPrice: retailPrice.price,
        referencePrice,
        salePrice: product.salePrice == null ? null : Number(product.salePrice),
        action: product.action
          ? {
              name: product.action.name,
              startsAt: product.action.startsAt,
              endsAt: product.action.endsAt,
              isPermanent: product.action.isPermanent,
            }
          : null,
        actionPrices: product.actionPrices.map((entry) => ({
          price: Number(entry.salePrice),
          priority: entry.action.priority,
          startsAt: entry.action.startsAt,
          endsAt: entry.action.endsAt,
          isPermanent: entry.action.isPermanent,
          actionId: entry.action.id,
          actionName: entry.action.name,
        })),
        linearPromotions: ruleInputs.linearPromotions,
      },
      { now: evaluatedAt, loggedIn: false },
    ).payable;
    return [product.sku, price] as const;
  }));
  const warnings: string[] = [];

  const body = blocks.map((block) => {
    switch (block.type) {
      case "heading":
        return `<h2 style="font-family:Arial,Helvetica,sans-serif;font-size:28px;font-weight:700;line-height:1.2;letter-spacing:-.02em;margin:0 0 16px;color:${EMAIL_COLORS.ink};">${escapeHtml(block.text)}</h2>`;
      case "text":
        return `<p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;margin:0 0 20px;color:${EMAIL_COLORS.muted};">${escapeHtml(block.text).replace(/\n/g, "<br>")}</p>`;
      case "image": {
        const image = `<img src="${escapeAttr(absoluteUrl(block.url, baseUrl))}" alt="${escapeAttr(block.alt)}" width="592" style="display:block;width:100%;height:auto;border:0;border-radius:8px;margin:0 0 22px;">`;
        return block.href
          ? `<a href="${escapeAttr(absoluteUrl(block.href, baseUrl))}" style="text-decoration:none;">${image}</a>`
          : image;
      }
      case "button":
        return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td bgcolor="${EMAIL_COLORS.blue}" style="background:${EMAIL_COLORS.blue};border-radius:7px;"><a href="${escapeAttr(absoluteUrl(block.href, baseUrl))}" style="display:inline-block;color:${EMAIL_COLORS.white};padding:13px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:1.2;text-decoration:none;">${escapeHtml(block.label)}</a></td></tr></table>`;
      case "divider":
        return `<hr style="border:0;border-top:1px solid ${EMAIL_COLORS.line};margin:26px 0;">`;
      case "voucher":
        return `<div style="border:1px dashed ${EMAIL_COLORS.blue};background:${EMAIL_COLORS.blueSoft};border-radius:8px;padding:20px;margin:0 0 22px;text-align:center;"><p style="font:700 11px Arial,Helvetica,sans-serif;text-transform:uppercase;letter-spacing:.12em;color:${EMAIL_COLORS.blue};margin:0 0 8px;">Kod za popust</p><p style="font:700 24px monospace;color:${EMAIL_COLORS.ink};margin:0 0 8px;">${escapeHtml(block.code)}</p>${block.text ? `<p style="font:13px Arial,Helvetica,sans-serif;color:${EMAIL_COLORS.muted};margin:0;">${escapeHtml(block.text)}</p>` : ""}</div>`;
      case "products": {
        const cards = block.skus.flatMap((sku) => {
          const product = bySku.get(sku);
          if (!product) {
            warnings.push(`Artikal ${sku} nije aktivan ili nije dostupan za web i izostavljen je.`);
            return [];
          }
          const href = `${baseUrl.replace(/\/$/, "")}/p/${encodeURIComponent(product.slug)}`;
          const media = product.media[0];
          const imageUrl = media?.cardUrl ?? media?.url;
          const price = pricesBySku.get(product.sku);
          if (!price) {
            warnings.push(`Cena artikla ${sku} nije dostupna i artikal je izostavljen.`);
            return [];
          }
          const displayName = formatProductDisplayName(
            product.shortName ?? product.name,
            product.sizeLabel,
          );
          const oldPrice = price.effective < price.full
            ? `<span style="color:${EMAIL_COLORS.muted};text-decoration:line-through;margin-left:7px;">${escapeHtml(formatRsd(price.full))}</span>`
            : "";
          return [`<td width="50%" valign="top" style="padding:8px;"><a href="${escapeAttr(href)}" style="color:${EMAIL_COLORS.ink};text-decoration:none;">${imageUrl ? `<img src="${escapeAttr(absoluteUrl(imageUrl, baseUrl))}" alt="${escapeAttr(media?.alt ?? displayName)}" width="260" style="display:block;width:100%;height:auto;border-radius:8px;border:0;margin-bottom:10px;">` : ""}<span style="display:block;font:700 14px Arial,Helvetica,sans-serif;line-height:1.35;margin-bottom:7px;">${escapeHtml(displayName)}</span><span style="font:700 14px Arial,Helvetica,sans-serif;color:${EMAIL_COLORS.blue};">${escapeHtml(formatRsd(price.effective))}</span>${oldPrice}</a></td>`];
        });
        if (!cards.length) return "";
        const rows: string[] = [];
        for (let i = 0; i < cards.length; i += 2) {
          rows.push(`<tr>${cards[i]}${cards[i + 1] ?? '<td width="50%"></td>'}</tr>`);
        }
        return `${block.title ? `<h2 style="font-family:Arial,Helvetica,sans-serif;font-size:23px;line-height:1.3;color:${EMAIL_COLORS.ink};margin:0 0 10px;">${escapeHtml(block.title)}</h2>` : ""}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -8px 22px;">${rows.join("")}</table>`;
      }
    }
  }).join("");

  if (!body.trim()) warnings.push("Kampanja nema vidljiv sadržaj.");
  const unsubscribeUrl = options.unsubscribeUrl ?? "{{{RESEND_UNSUBSCRIBE_URL}}}";
  const preview = escapeHtml(options.previewText?.trim() || options.subject);
  const logoUrl = absoluteUrl("/documents/garantni-list-logo.jpeg", baseUrl);
  const html = `<!doctype html><html lang="sr-Latn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(options.subject)}</title></head><body style="margin:0;background:${EMAIL_COLORS.page};color:${EMAIL_COLORS.ink};font-family:Arial,Helvetica,sans-serif;"><span style="display:none!important;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;line-height:1px;">${preview}</span><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:${EMAIL_COLORS.page};"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;margin:0 auto;border-collapse:separate;background:${EMAIL_COLORS.white};border-top:5px solid ${EMAIL_COLORS.blue};border-radius:12px;box-shadow:0 8px 24px rgba(18,63,90,.10);"><tr><td style="padding:28px 24px 18px;"><a href="${escapeAttr(baseUrl)}" style="display:inline-block;text-decoration:none;"><img src="${escapeAttr(logoUrl)}" alt="${escapeAttr(BRAND.name)}" width="220" height="36" style="display:block;width:220px;max-width:78%;height:auto;border:0;"></a></td></tr><tr><td style="padding:8px 24px 32px;">${body}</td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;margin:0 auto;border-collapse:collapse;"><tr><td align="center" style="padding:18px 12px 0;font:11px/1.6 Arial,Helvetica,sans-serif;color:${EMAIL_COLORS.muted};">Ovu poruku primate jer se vaša adresa nalazi na listi kontakata.<br><a href="${escapeAttr(unsubscribeUrl)}" style="color:${EMAIL_COLORS.blue};text-decoration:underline;">Odjavite se ili promenite podešavanja</a><br>${escapeHtml(BRAND.legalName)} · Beograd, Srbija<br><a href="${escapeAttr(baseUrl)}" style="color:${EMAIL_COLORS.blue};text-decoration:underline;">${escapeHtml(BRAND.domain)}</a></td></tr></table></td></tr></table></body></html>`;
  const text = blocks.map((block) => {
    switch (block.type) {
      case "heading":
      case "text": return block.text;
      case "image": return block.alt;
      case "button": return `${block.label}: ${absoluteUrl(block.href, baseUrl)}`;
      case "voucher": return `Kod za popust: ${block.code}${block.text ? ` — ${block.text}` : ""}`;
      case "products": return block.skus.flatMap((sku) => {
        const product = bySku.get(sku);
        const price = pricesBySku.get(sku);
        return product && price ? [`${formatProductDisplayName(product.shortName ?? product.name, product.sizeLabel)} — ${formatRsd(price.effective)} — ${baseUrl.replace(/\/$/, "")}/p/${product.slug}`] : [];
      }).join("\n");
      case "divider": return "---";
    }
  }).filter(Boolean).join("\n\n") + `\n\nOdjava: ${unsubscribeUrl}`;

  return { blocks, html, text, warnings };
}

export function defaultNewsletterContent(): NewsletterBlock[] {
  return [
    { id: "heading-1", type: "heading", text: "Nova ponuda u Svetu Povoljnih Cena" },
    { id: "text-1", type: "text", text: "Dopunite tekst kampanje i izaberite proizvode koje želite da predstavite." },
    { id: "button-1", type: "button", label: "Pogledaj ponudu", href: "/akcija" },
  ];
}

function safeUrl(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function absoluteUrl(value: string, baseUrl: string) {
  return value.startsWith("/") ? `${baseUrl.replace(/\/$/, "")}${value}` : value;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeAttr(value: string) {
  return escapeHtml(value);
}
