import rawProducts from "@/data/svet-akcija-products.json";

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
    category: string | null;
    group: string | null;
    regularPrice: string | null;
    salePrice: string | null;
    brandOrCollection: string | null;
    colorPrimary: string | null;
    colorSecondary: string | null;
    barcode: string | null;
    sku: string | null;
  };
  flags: string[];
  longDescription?: string | null;
  media?: {
    images: {
      url: string;
      thumbUrl?: string | null;
      cardUrl?: string | null;
      pdpUrl?: string | null;
      alt?: string | null;
      width?: number | null;
      height?: number | null;
      blurDataUrl?: string | null;
    }[];
  };
}

const PLACEHOLDER_VALUES = new Set(["9", "0", "/", "-", "N/A", "n/a", "NA", "na"]);

export const svetAkcijaProducts = rawProducts as SvetAkcijaProduct[];

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
  return product.media?.images[0] ?? null;
}
