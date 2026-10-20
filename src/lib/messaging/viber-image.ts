/** Viber may crop a wide inline image. Use the square asset for our wide logo. */
export const VIBER_LOGO_PATH = "/viber-logo.jpg";
export function viberImageUrl(value: string) {
  try {
    const url = new URL(value);
    if (["svetpovoljnihcena.rs", "www.svetpovoljnihcena.rs", "tpovoljnihcena.rs", "www.tpovoljnihcena.rs"].includes(url.hostname) && /^\/logo\.(?:svg|jpe?g|png|webp)$/i.test(url.pathname)) {
      return `https://www.svetpovoljnihcena.rs${VIBER_LOGO_PATH}`;
    }
  } catch { /* Invalid URLs are rejected by the message schema. */ }
  return value;
}
