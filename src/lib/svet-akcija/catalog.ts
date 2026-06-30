import rawProducts from "@/data/svet-akcija-products.json";

interface SvetAkcijaMediaAsset {
  url?: string | null;
  storagePath?: string | null;
  thumbUrl?: string | null;
  cardUrl?: string | null;
  pdpUrl?: string | null;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
  blurDataUrl?: string | null;
}

type SvetAkcijaWebsiteMedia =
  | SvetAkcijaMediaAsset[]
  | { images: SvetAkcijaMediaAsset[] };

export interface SvetAkcijaSource {
  "Šifra": string | null;
  "Kategorija": string | null;
  "Grupa": string | null;
  "Dobavljač": string | null;
  "Kolekcija (brend)": string | null;
  "Opis": string | null;
  "Kratki naziv": string | null;
  "Atribut 1": string | null;
  "Atribut 2": string | null;
  "Boja 1": string | null;
  "Boja 2": string | null;
  "DC (lager)": string | null;
  "Bar kod": string | null;
  "MPC redovna": string | null;
  "Akcijska MPC": string | null;
  "Važenje akcijske cene od": string | null;
  "Važenje akcijske cene do": string | null;
}

export interface SvetAkcijaProduct {
  source: SvetAkcijaSource;
  website_mapping: {
    id: string | null;
    title: string | null;
    shortDescription: string | null;
    longDescription?: string | null;
    category: string | null;
    group: string | null;
    regularPrice: string | null;
    salePrice: string | null;
    brandOrCollection: string | null;
    colorPrimary: string | null;
    colorSecondary: string | null;
    barcode: string | null;
    sku: string | null;
    media?: SvetAkcijaWebsiteMedia;
  };
  flags: string[];
  longDescription?: string | null;
  media?: {
    images: SvetAkcijaMediaAsset[];
  };
}

const PLACEHOLDER_VALUES = new Set(["9", "0", "/", "-", "N/A", "n/a", "NA", "na"]);
const LFS_POINTER_RE = /^(version https:\/\/git-lfs\.github\.com\/spec\/v1\b|oid sha256:)/i;

export const svetAkcijaProducts = rawProducts as unknown as SvetAkcijaProduct[];

export function sourceValue(
  product: SvetAkcijaProduct,
  field: keyof SvetAkcijaSource,
): string {
  return product.source[field] ?? "";
}

export function isMeaningfulSourceValue(value: string | null | undefined): value is string {
  if (value == null || value === "") return false;
  return !PLACEHOLDER_VALUES.has(value.trim());
}

export function parseSourcePrice(value: string | null | undefined): number | null {
  if (!isMeaningfulSourceValue(value)) return null;
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function isLfsPointerText(value: string | null | undefined) {
  return Boolean(value && LFS_POINTER_RE.test(value.trim()));
}

function parseSourceDate(value: string | null | undefined): Date | null {
  if (!isMeaningfulSourceValue(value)) return null;
  const date = new Date(value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isSourceCampaignLive(
  product: SvetAkcijaProduct,
  now: Date = new Date(),
) {
  const startsAt = parseSourceDate(sourceValue(product, "Važenje akcijske cene od"));
  const endsAt = parseSourceDate(sourceValue(product, "Važenje akcijske cene do"));
  if (!startsAt || !endsAt) return false;
  const time = now.getTime();
  return startsAt.getTime() <= time && endsAt.getTime() >= time;
}

export function sourceLongDescription(product: SvetAkcijaProduct) {
  const raw =
    product.longDescription ??
    product.website_mapping.longDescription ??
    sourceValue(product, "Opis");
  if (!raw || isLfsPointerText(raw)) return sourceValue(product, "Opis");
  return raw;
}

export function sourceMediaImages(product: SvetAkcijaProduct) {
  const media = product.media?.images ?? product.website_mapping.media;
  const images = Array.isArray(media) ? media : media?.images;
  return (images ?? []).map((image) => ({
    ...image,
    url: image.url ?? image.storagePath ?? "",
  }));
}

export function effectiveSourcePrice(product: SvetAkcijaProduct) {
  const fullPrice = parseSourcePrice(sourceValue(product, "MPC redovna"));
  const rawSalePrice = parseSourcePrice(sourceValue(product, "Akcijska MPC"));
  const salePrice =
    fullPrice != null &&
    rawSalePrice != null &&
    rawSalePrice > 0 &&
    rawSalePrice < fullPrice &&
    isSourceCampaignLive(product)
      ? rawSalePrice
      : null;

  return {
    fullPrice,
    salePrice,
    effective: salePrice ?? fullPrice ?? rawSalePrice,
    onSale: salePrice != null,
    campaignLive: isSourceCampaignLive(product),
  };
}

export function uniqueMeaningfulValues(
  products: SvetAkcijaProduct[],
  fields: (keyof SvetAkcijaSource)[],
): string[] {
  const values = new Set<string>();
  for (const product of products) {
    for (const field of fields) {
      const value = product.source[field];
      if (isMeaningfulSourceValue(value)) values.add(value);
    }
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b, "sr-Latn-RS"));
}

export function productHref(product: SvetAkcijaProduct): string {
  return `/svet-akcija/${encodeURIComponent(sourceValue(product, "Šifra"))}`;
}

export function primaryImage(product: SvetAkcijaProduct) {
  return sourceMediaImages(product)[0] ?? null;
}
