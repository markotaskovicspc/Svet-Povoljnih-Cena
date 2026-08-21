import { SaxesParser, type SaxesTagNS } from "saxes";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
  "link",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
  "discard",
]);
const EMBEDDED_RASTER = /^data:(image\/(?:png|jpeg|webp|avif));base64,([\s\S]+)$/i;

class SvgValidationError extends Error {}

function reject(message: string): never {
  throw new SvgValidationError(message);
}

function startsWithBytes(bytes: Uint8Array, expected: number[]) {
  return expected.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, value: string) {
  return [...value].every(
    (character, index) => bytes[offset + index] === character.charCodeAt(0),
  );
}

function hasRasterSignature(mime: string, bytes: Uint8Array) {
  if (mime === "image/png") {
    return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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

function validateEmbeddedRaster(value: string) {
  const match = value.match(EMBEDDED_RASTER);
  if (!match) {
    reject(
      "SVG sadrži povezanu sliku. Ugradite je u SVG (Embed) ili izvezite fajl kao PNG/WebP.",
    );
  }

  const mime = match[1].toLowerCase();
  const base64 = match[2].replace(/[\t\n\r ]/g, "");
  if (
    base64.length === 0 ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) {
    reject("SVG sadrži neispravnu ugrađenu sliku.");
  }

  let decoded: Uint8Array;
  try {
    const binary = atob(base64);
    decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    reject("SVG sadrži neispravnu ugrađenu sliku.");
  }
  if (!hasRasterSignature(mime, decoded)) {
    reject("SVG sadrži neispravnu ugrađenu sliku.");
  }
}

function decodeCssEscapes(value: string) {
  return value.replace(
    /\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([^\r\n\f0-9a-f])/gi,
    (_match, hexadecimal: string | undefined, character: string | undefined) =>
      hexadecimal
        ? String.fromCodePoint(Number.parseInt(hexadecimal, 16) || 0xfffd)
        : (character ?? ""),
  );
}

function validateCss(value: string) {
  const css = decodeCssEscapes(value.replace(/\/\*[\s\S]*?\*\//g, ""));
  if (/@import/i.test(css)) {
    reject("SVG ne sme da učitava spoljne resurse.");
  }

  const withoutInternalReferences = css.replace(
    /url\s*\(\s*(?:(["'])#[^"'()]*\1|#[^"'()\s]+)\s*\)/gi,
    "",
  );
  if (/url\s*\(/i.test(withoutInternalReferences)) {
    reject("SVG ne sme da učitava spoljne resurse.");
  }
}

function validateElement(tag: SaxesTagNS) {
  const elementName = tag.local.toLowerCase();
  if (FORBIDDEN_ELEMENTS.has(elementName)) {
    reject("SVG sadrži nedozvoljen aktivni sadržaj.");
  }

  for (const attribute of Object.values(tag.attributes)) {
    const attributeName = attribute.local.toLowerCase();
    const value = attribute.value.trim();
    if (attributeName.startsWith("on")) {
      reject("SVG sadrži nedozvoljen aktivni sadržaj.");
    }
    if (attributeName === "href") {
      if (!value || value.startsWith("#")) continue;
      if (elementName === "image" && value.toLowerCase().startsWith("data:")) {
        validateEmbeddedRaster(value);
        continue;
      }
      if (elementName === "image") {
        reject(
          "SVG sadrži povezanu sliku. Ugradite je u SVG (Embed) ili izvezite fajl kao PNG/WebP.",
        );
      }
      reject("SVG ne sme da učitava spoljne resurse.");
    }
    if (attributeName === "src" && value) {
      reject("SVG ne sme da učitava spoljne resurse.");
    }
    if (attributeName === "style" || /url\s*\(|@import/i.test(value)) {
      validateCss(value);
    }
  }
}

/**
 * SVG is executable markup, so accepting the MIME type alone is not safe.
 * Self-contained vector artwork and embedded raster images are supported;
 * scripts, event handlers, embedded HTML and external resources are rejected.
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
  let rootSeen = false;
  let styleDepth = 0;
  let styleText = "";
  const parser = new SaxesParser({ xmlns: true });

  parser.on("doctype", () => {
    reject("SVG ne sme da sadrži spoljne deklaracije.");
  });
  parser.on("processinginstruction", () => {
    reject("SVG ne sme da sadrži spoljne deklaracije.");
  });
  parser.on("opentag", (tag) => {
    if (!rootSeen) {
      if (tag.local.toLowerCase() !== "svg" || tag.uri !== SVG_NAMESPACE) {
        reject("Fajl nije ispravan SVG dokument.");
      }
      rootSeen = true;
    }
    validateElement(tag);
    if (tag.local.toLowerCase() === "style") {
      styleDepth += 1;
      styleText = "";
    }
  });
  parser.on("text", (text) => {
    if (styleDepth > 0) styleText += text;
  });
  parser.on("cdata", (text) => {
    if (styleDepth > 0) styleText += text;
  });
  parser.on("closetag", (tag) => {
    if (tag.local.toLowerCase() !== "style") return;
    validateCss(styleText);
    styleDepth -= 1;
    styleText = "";
  });

  try {
    parser.write(normalized).close();
  } catch (error) {
    if (error instanceof SvgValidationError) throw error;
    throw new Error("Fajl nije ispravan SVG dokument.");
  }
  if (!rootSeen) throw new Error("Fajl nije ispravan SVG dokument.");
  return normalized;
}
