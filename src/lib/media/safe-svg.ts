const FORBIDDEN_ELEMENTS =
  /<(?:script|foreignObject|iframe|object|embed|image|audio|video)\b/i;
const EVENT_HANDLER = /\son[a-z][a-z0-9_-]*\s*=/i;
const HREF_ATTRIBUTE = /\s(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi;

/**
 * SVG is executable markup, so accepting the MIME type alone is not safe.
 * This deliberately supports self-contained artwork only: no scripts, event
 * handlers, embedded HTML, remote resources, data URLs or CSS imports.
 */
export function validateSafeSvgBytes(input: ArrayBuffer | Uint8Array) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("SVG mora biti ispravan UTF-8 fajl.");
  }

  const normalized = source.replace(/^\uFEFF/, "").trim();
  if (!/<svg\b[^>]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(normalized)) {
    throw new Error("Fajl nije ispravan SVG dokument.");
  }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(normalized)) {
    throw new Error("SVG ne sme da sadrži spoljne deklaracije.");
  }
  if (FORBIDDEN_ELEMENTS.test(normalized) || EVENT_HANDLER.test(normalized)) {
    throw new Error("SVG sadrži nedozvoljen aktivni sadržaj.");
  }
  if (/@import|url\s*\(/i.test(normalized)) {
    throw new Error("SVG ne sme da učitava spoljne resurse.");
  }
  for (const match of normalized.matchAll(HREF_ATTRIBUTE)) {
    const value = match[2]?.trim() ?? "";
    if (value && !value.startsWith("#")) {
      throw new Error("SVG ne sme da učitava spoljne resurse.");
    }
  }
  return normalized;
}
