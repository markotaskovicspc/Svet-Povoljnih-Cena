import "server-only";

import path from "node:path";
import sharp, { type Metadata } from "sharp";

const MAX_INPUT_PIXELS = 80_000_000;

export const PRODUCT_IMAGE_VARIANTS = [
  { name: "thumb", width: 160, quality: 76 },
  { name: "card", width: 640, quality: 78 },
  { name: "pdp", width: 1280, quality: 82 },
] as const;

export const PRODUCT_MEDIA_IMMUTABLE_CACHE_SECONDS = "31536000";

export type ProductImageVariantName =
  (typeof PRODUCT_IMAGE_VARIANTS)[number]["name"];

export type ProductImageVariant = {
  name: ProductImageVariantName;
  width: number;
  key: string;
  buffer: Buffer;
};

export type ProductImageRenditions = {
  width: number;
  height: number;
  variants: ProductImageVariant[];
};

export function productImageVariantKey(
  sourceKey: string,
  variant: (typeof PRODUCT_IMAGE_VARIANTS)[number],
) {
  const normalized = sourceKey.replace(/^\/+/, "");
  const parsed = path.posix.parse(normalized);
  const sourceBase = path.posix.join(parsed.dir, parsed.name);
  return path.posix.join(
    "variants",
    variant.name,
    `${sourceBase}-${variant.width}.webp`,
  );
}

export async function buildProductImageRenditions(
  source: Buffer,
  sourceKey: string,
): Promise<ProductImageRenditions> {
  let metadata: Metadata;
  try {
    metadata = await sharp(source, {
      failOn: "warning",
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
  } catch {
    throw new Error(
      "Fajl nije čitljiva slika. Izaberite ispravan PNG, JPG, WebP ili AVIF.",
    );
  }
  if (!metadata.width || !metadata.height) {
    throw new Error("Nije moguće utvrditi dimenzije fotografije.");
  }

  const orientationSwapsDimensions =
    metadata.orientation !== undefined && metadata.orientation >= 5;
  const width = orientationSwapsDimensions ? metadata.height : metadata.width;
  const height = orientationSwapsDimensions ? metadata.width : metadata.height;

  try {
    const variants = await Promise.all(
      PRODUCT_IMAGE_VARIANTS.map(async (variant) => ({
        name: variant.name,
        width: variant.width,
        key: productImageVariantKey(sourceKey, variant),
        buffer: await sharp(source, {
          failOn: "warning",
          limitInputPixels: MAX_INPUT_PIXELS,
        })
          .rotate()
          .resize({
            width: variant.width,
            height: variant.width,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: variant.quality, effort: 4 })
          .toBuffer(),
      })),
    );
    return { width, height, variants };
  } catch {
    throw new Error(
      "Fotografiju nije moguće optimizovati. Izaberite ispravan PNG, JPG, WebP ili AVIF.",
    );
  }
}
