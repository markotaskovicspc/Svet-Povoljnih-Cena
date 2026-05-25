import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const IMAGE_EXTENSIONS = new Set([".avif", ".jpg", ".jpeg", ".png", ".webp"]);
const VARIANTS = [
  { name: "thumb", width: 160, quality: 76 },
  { name: "card", width: 640, quality: 78 },
  { name: "pdp", width: 1280, quality: 82 },
];

const manifestPath =
  process.argv[2] || "outputs/svet-akcija-product-media-upload-manifest.json";
const outputDir = process.argv[3] || "outputs/product-media-variants";
const outputManifestPath =
  process.argv[4] || "outputs/svet-akcija-product-media-variants.json";
const onlyStoragePath = process.env.ONLY_STORAGE_PATH;
const onlyRelativeSourcePath = process.env.ONLY_RELATIVE_SOURCE_PATH;

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const sourceEntries = (manifest.entries || []).filter((entry) => {
  if (!IMAGE_EXTENSIONS.has(path.extname(entry.localSourcePath).toLowerCase())) {
    return false;
  }
  if (onlyStoragePath) return entry.storagePath === onlyStoragePath;
  if (onlyRelativeSourcePath) {
    return entry.relativeSourcePath === onlyRelativeSourcePath;
  }
  return true;
});

await mkdir(outputDir, { recursive: true });

const entries = [];
let skipped = 0;

for (const entry of sourceEntries) {
  try {
    await stat(entry.localSourcePath);
    const source = sharp(entry.localSourcePath, { failOn: "none" }).rotate();
    const metadata = await source.metadata();
    const sourceWidth = metadata.width || 0;
    const sourceHeight = metadata.height || 0;
    const parsedStoragePath = path.parse(entry.storagePath);
    const storageBase = path.posix.join(
      parsedStoragePath.dir,
      parsedStoragePath.name,
    );

    for (const variant of VARIANTS) {
      const relativeVariantPath = path.join(
        entry.sku,
        `${parsedStoragePath.name}-${variant.name}-${variant.width}.webp`,
      );
      const localVariantPath = path.join(outputDir, relativeVariantPath);
      const absoluteVariantPath = path.resolve(localVariantPath);
      await mkdir(path.dirname(localVariantPath), { recursive: true });

      const image = sharp(entry.localSourcePath, { failOn: "none" }).rotate();
      await image
        .resize({
          width: variant.width,
          height: variant.width,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: variant.quality, effort: 5 })
        .toFile(absoluteVariantPath);

      const storagePath = path.posix.join(
        "variants",
        variant.name,
        `${storageBase}-${variant.width}.webp`,
      );

      entries.push({
        sku: entry.sku,
        mediaId: entry.mediaId,
        mediaOrder: entry.mediaOrder,
        variant: variant.name,
        width: variant.width,
        sourceWidth,
        sourceHeight,
        localSourcePath: absoluteVariantPath,
        relativeSourcePath: path.relative(process.cwd(), absoluteVariantPath),
        storagePath,
        sourceStoragePath: entry.storagePath,
      });
    }
  } catch (error) {
    skipped += 1;
    console.error(`Skipped ${entry.relativeSourcePath}: ${error.message}`);
  }
}

await writeFile(
  outputManifestPath,
  JSON.stringify(
    {
      summary: {
        sourceManifest: manifestPath,
        sourceImageCount: sourceEntries.length,
        variantCount: entries.length,
        skipped,
        variants: VARIANTS,
      },
      entries,
    },
    null,
    2,
  ),
);

console.log(`Wrote ${entries.length} variants to ${outputDir}`);
console.log(`Wrote upload manifest to ${outputManifestPath}`);
if (skipped > 0) process.exitCode = 1;
