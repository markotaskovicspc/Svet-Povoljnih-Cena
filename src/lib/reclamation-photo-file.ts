const IMAGE_EXTENSION_BY_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export function createReclamationPhotoFile(blob: Blob, sourceName: string) {
  const contentType = blob.type as keyof typeof IMAGE_EXTENSION_BY_TYPE;
  const extension = IMAGE_EXTENSION_BY_TYPE[contentType];
  if (!extension) {
    throw new Error("unsupported_canvas_output_type");
  }

  const baseName = sourceName.replace(/\.[^.]+$/, "") || "fotografija";
  return new File([blob], `${baseName}.${extension}`, { type: contentType });
}
