/** GSM 03.38: extension characters occupy two septets; Unicode uses UTF-16. */
const basic = new Set(Array.from("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"));
const extension = new Set(Array.from("\f^{}\\[~]|€"));
export function smsSegments(text: string) {
  const gsm = Array.from(text).every(c => basic.has(c) || extension.has(c));
  const units = gsm ? Array.from(text).reduce((n,c) => n + (extension.has(c) ? 2 : 1), 0) : text.length;
  const single = gsm ? 160 : 70;
  const multipart = gsm ? 153 : 67;
  return { encoding: gsm ? "GSM-7" : "Unicode", units, parts: units ? units <= single ? 1 : Math.ceil(units / multipart) : 0 };
}
