// Below the hosting request-body limit, including multipart overhead.
export const NEWSLETTER_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const NEWSLETTER_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

export function validateNewsletterImageFile(file: Pick<File, "type" | "size">) {
  if (!file.size) throw new Error("Izaberite sliku sa uređaja.");
  if (file.size > NEWSLETTER_IMAGE_MAX_BYTES) throw new Error("Slika ne sme biti veća od 4 MB.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Podržani formati su JPG, PNG i WebP.");
  }
}
