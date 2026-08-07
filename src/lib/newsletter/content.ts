import "server-only";

import { z } from "zod";
import { db } from "@/lib/db";
import { webStorefrontProductWhere } from "@/lib/web-storefront-availability";
import { BRAND } from "@/lib/brand";
import { formatRsd } from "@/lib/format";
import { formatProductDisplayName } from "@/lib/product-name";

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

export async function renderNewsletterCampaign(options: RenderOptions) {
  const blocks = newsletterContentSchema.parse(options.content);
  const baseUrl = options.baseUrl ?? BRAND.url;
  const productSkus = Array.from(
    new Set(
      blocks.flatMap((block) => block.type === "products" ? block.skus : []),
    ),
  );
  const products = productSkus.length
    ? await db.product.findMany({
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
          media: {
            where: { kind: "IMAGE", syncStatus: "READY" },
            orderBy: { order: "asc" },
            take: 1,
            select: { url: true, cardUrl: true, alt: true },
          },
        },
      })
    : [];
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const warnings: string[] = [];

  const body = blocks.map((block) => {
    switch (block.type) {
      case "heading":
        return `<h2 style="font-family:Georgia,serif;font-size:28px;line-height:1.2;margin:0 0 16px;color:#1A1714;">${escapeHtml(block.text)}</h2>`;
      case "text":
        return `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.65;margin:0 0 20px;color:#3B342D;">${escapeHtml(block.text).replace(/\n/g, "<br>")}</p>`;
      case "image": {
        const image = `<img src="${escapeAttr(absoluteUrl(block.url, baseUrl))}" alt="${escapeAttr(block.alt)}" width="600" style="display:block;width:100%;height:auto;border:0;border-radius:14px;margin:0 0 22px;">`;
        return block.href
          ? `<a href="${escapeAttr(absoluteUrl(block.href, baseUrl))}" style="text-decoration:none;">${image}</a>`
          : image;
      }
      case "button":
        return `<p style="margin:0 0 24px;"><a href="${escapeAttr(absoluteUrl(block.href, baseUrl))}" style="display:inline-block;background:#1A1714;color:#FAF7F2;padding:13px 24px;border-radius:999px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;">${escapeHtml(block.label)}</a></p>`;
      case "divider":
        return `<hr style="border:0;border-top:1px solid #E8E0D2;margin:26px 0;">`;
      case "voucher":
        return `<div style="border:1px dashed #6B4423;background:#FAF7F2;border-radius:14px;padding:20px;margin:0 0 22px;text-align:center;"><p style="font:12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.12em;color:#6B6259;margin:0 0 8px;">Kod za popust</p><p style="font:700 24px monospace;color:#1A1714;margin:0 0 8px;">${escapeHtml(block.code)}</p>${block.text ? `<p style="font:13px Arial,sans-serif;color:#6B6259;margin:0;">${escapeHtml(block.text)}</p>` : ""}</div>`;
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
          const price = Number(product.salePrice ?? product.fullPrice);
          const displayName = formatProductDisplayName(
            product.shortName ?? product.name,
            product.sizeLabel,
          );
          const oldPrice = product.salePrice
            ? `<span style="color:#8A8178;text-decoration:line-through;margin-left:7px;">${escapeHtml(formatRsd(Number(product.fullPrice)))}</span>`
            : "";
          return [`<td width="50%" valign="top" style="padding:8px;"><a href="${escapeAttr(href)}" style="color:#1A1714;text-decoration:none;">${imageUrl ? `<img src="${escapeAttr(absoluteUrl(imageUrl, baseUrl))}" alt="${escapeAttr(media?.alt ?? displayName)}" width="260" style="display:block;width:100%;height:auto;border-radius:12px;border:0;margin-bottom:10px;">` : ""}<span style="display:block;font:700 14px Arial,sans-serif;line-height:1.35;margin-bottom:7px;">${escapeHtml(displayName)}</span><span style="font:700 14px Arial,sans-serif;color:#6B4423;">${escapeHtml(formatRsd(price))}</span>${oldPrice}</a></td>`];
        });
        if (!cards.length) return "";
        const rows: string[] = [];
        for (let i = 0; i < cards.length; i += 2) {
          rows.push(`<tr>${cards[i]}${cards[i + 1] ?? '<td width="50%"></td>'}</tr>`);
        }
        return `${block.title ? `<h2 style="font-family:Georgia,serif;font-size:23px;margin:0 0 10px;">${escapeHtml(block.title)}</h2>` : ""}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -8px 22px;">${rows.join("")}</table>`;
      }
    }
  }).join("");

  if (!body.trim()) warnings.push("Kampanja nema vidljiv sadržaj.");
  const unsubscribeUrl = options.unsubscribeUrl ?? "{{{RESEND_UNSUBSCRIBE_URL}}}";
  const preview = escapeHtml(options.previewText?.trim() || options.subject);
  const html = `<!doctype html><html lang="sr-Latn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(options.subject)}</title></head><body style="margin:0;background:#FAF7F2;color:#1A1714;"><span style="display:none!important;max-height:0;overflow:hidden;opacity:0;">${preview}</span><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F2;"><tr><td style="padding:28px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:624px;margin:0 auto;"><tr><td style="padding:0 10px 20px;font-family:Georgia,serif;font-size:24px;">${escapeHtml(BRAND.name)}</td></tr><tr><td style="background:#fff;border-radius:18px;padding:30px;">${body}</td></tr><tr><td style="padding:20px 10px;font:11px/1.6 Arial,sans-serif;color:#6B6259;">Ovu poruku primate jer ste dali saglasnost za promotivne mejlove.<br><a href="${escapeAttr(unsubscribeUrl)}" style="color:#6B4423;">Odjavite se ili promenite podešavanja</a><br>${escapeHtml(BRAND.legalName)} · Beograd, Srbija · <a href="${escapeAttr(baseUrl)}" style="color:#6B4423;">${escapeHtml(BRAND.domain)}</a></td></tr></table></td></tr></table></body></html>`;
  const text = blocks.map((block) => {
    switch (block.type) {
      case "heading":
      case "text": return block.text;
      case "image": return block.alt;
      case "button": return `${block.label}: ${absoluteUrl(block.href, baseUrl)}`;
      case "voucher": return `Kod za popust: ${block.code}${block.text ? ` — ${block.text}` : ""}`;
      case "products": return block.skus.flatMap((sku) => {
        const product = bySku.get(sku);
        return product ? [`${formatProductDisplayName(product.shortName ?? product.name, product.sizeLabel)} — ${formatRsd(Number(product.salePrice ?? product.fullPrice))} — ${baseUrl.replace(/\/$/, "")}/p/${product.slug}`] : [];
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
