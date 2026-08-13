import sharp from "sharp";

const MAX_STORAGE_IMAGE_BYTES = 5 * 1024 * 1024;
const OUTPUT_CANDIDATES = [
  { maxDimension: 2560, quality: 88 },
  { maxDimension: 2560, quality: 78 },
  { maxDimension: 1920, quality: 76 },
  { maxDimension: 1600, quality: 70 },
] as const;

export type NormalizedRabaluxImage = {
  buffer: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
};

/**
 * Standard Supabase uploads can reject otherwise valid large source images.
 * Normalize the mirrored original to a browser-friendly WebP below the upload
 * ceiling; card/PDP variants are still generated separately from the source.
 */
export async function normalizeRabaluxImageForStorage(
  source: Buffer,
): Promise<NormalizedRabaluxImage> {
  for (const candidate of OUTPUT_CANDIDATES) {
    const output = await sharp(source, { failOn: "error" })
      .rotate()
      .resize({
        width: candidate.maxDimension,
        height: candidate.maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: candidate.quality, effort: 5 })
      .toBuffer({ resolveWithObject: true });

    if (
      output.data.length <= MAX_STORAGE_IMAGE_BYTES &&
      output.info.width > 0 &&
      output.info.height > 0
    ) {
      return {
        buffer: output.data,
        contentType: "image/webp",
        width: output.info.width,
        height: output.info.height,
      };
    }
  }

  throw new Error("Normalized Rabalux image still exceeds the storage limit.");
}
