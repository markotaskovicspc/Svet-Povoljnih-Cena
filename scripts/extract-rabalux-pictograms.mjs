import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const source = resolve(process.argv[2] ?? "");
const outputDirectory = resolve(
  process.argv[3] ?? "public/brand/pictograms/rabalux",
);

if (!process.argv[2]) {
  throw new Error(
    "Usage: node scripts/extract-rabalux-pictograms.mjs <rendered-English-page.png> [output-directory]",
  );
}

// Source: https://rabalux.com/images/pictograms.pdf
// Coordinates refer to page 3 (EN) of Rabalux's official pictograms.pdf,
// rendered at any resolution without cropping. The source page contains five
// aligned tables; every entry below selects the coloured supplier icon.
const REFERENCE_WIDTH = 2382;
const REFERENCE_HEIGHT = 1684;
const ROW_TOP = 122;
const ROW_HEIGHT = (1586 - ROW_TOP) / 28;
const COLUMN_CENTERS = [101.5, 566.5, 1031.5, 1496.5, 1961.5];
const CROP_SIZE = 48;
const OUTPUT_SIZE = 192;

const icons = [
  ["color-temperature.png", 1, 10],
  ["rgb.png", 1, 17],
  ["motion-sensor.png", 2, 6],
  ["microwave-sensor.png", 2, 7],
  ["light-sensor.png", 2, 8],
  ["solar.png", 2, 10],
  ["backlight.png", 2, 12],
  ["starry-effect.png", 2, 17],
  ["textile-cable.png", 2, 18],
  ["battery.png", 3, 6],
  ["timer.png", 3, 26],
  ["speaker.png", 3, 28],
  ["memory.png", 4, 1],
  ["nightlight.png", 4, 2],
  ["wireless-charging.png", 4, 4],
  ["bluetooth.png", 4, 6],
  ["usb-port.png", 4, 7],
  ["usb-charging.png", 4, 8],
  ["fan.png", 4, 13],
  ["own-design.png", 5, 15, 88, 44],
];

const metadata = await sharp(source).metadata();
if (!metadata.width || !metadata.height) {
  throw new Error("Rendered Rabalux pictogram page has no readable dimensions.");
}
const scaleX = metadata.width / REFERENCE_WIDTH;
const scaleY = metadata.height / REFERENCE_HEIGHT;

await mkdir(outputDirectory, { recursive: true });
for (
  const [
    filename,
    column,
    row,
    cropWidthReference = CROP_SIZE,
    cropHeightReference = cropWidthReference,
  ] of icons
) {
  const cropWidth = Math.round(cropWidthReference * scaleX);
  const cropHeight = Math.round(cropHeightReference * scaleY);
  const centerX = COLUMN_CENTERS[column - 1] * scaleX;
  const centerY = (ROW_TOP + (row - 0.5) * ROW_HEIGHT) * scaleY;
  await sharp(source)
    .extract({
      left: Math.round(centerX - cropWidth / 2),
      top: Math.round(centerY - cropHeight / 2),
      width: cropWidth,
      height: cropHeight,
    })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
      fit: "contain",
      background: "white",
    })
    .png()
    .toFile(resolve(outputDirectory, filename));
}

console.log(`Extracted ${icons.length} official Rabalux pictograms.`);
