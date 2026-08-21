export const EMBEDDABLE_RASTER_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
] as const;

export type EmbeddableRasterMime = (typeof EMBEDDABLE_RASTER_MIMES)[number];

function startsWithBytes(bytes: Uint8Array, expected: number[]) {
  return expected.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, value: string) {
  return [...value].every(
    (character, index) => bytes[offset + index] === character.charCodeAt(0),
  );
}

export function hasRasterSignature(
  mime: EmbeddableRasterMime,
  bytes: Uint8Array,
) {
  if (mime === "image/png") {
    return startsWithBytes(bytes, [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  }
  if (mime === "image/jpeg") {
    return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
  }
  if (mime === "image/webp") {
    return asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP");
  }
  if (mime === "image/avif") {
    if (!asciiAt(bytes, 4, "ftyp")) return false;
    const header = String.fromCharCode(...bytes.subarray(0, 64));
    return header.includes("avif") || header.includes("avis");
  }
  return false;
}

export function detectRasterMime(bytes: Uint8Array) {
  return EMBEDDABLE_RASTER_MIMES.find((mime) =>
    hasRasterSignature(mime, bytes),
  );
}
