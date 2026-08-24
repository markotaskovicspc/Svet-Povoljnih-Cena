import { SaxesParser, type SaxesTagNS } from "saxes";
import {
  hasRasterSignature,
  type EmbeddableRasterMime,
} from "./raster-signature";

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

function stripDoctypeDeclarations(source: string, expectedCount: number) {
  if (expectedCount === 0) return source;

  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < source.length) {
    const markupStart = source.indexOf("<", cursor);
    if (markupStart < 0) break;

    if (source.startsWith("<!--", markupStart)) {
      const commentEnd = source.indexOf("-->", markupStart + 4);
      if (commentEnd < 0) break;
      cursor = commentEnd + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", markupStart)) {
      const cdataEnd = source.indexOf("]]>", markupStart + 9);
      if (cdataEnd < 0) break;
      cursor = cdataEnd + 3;
      continue;
    }
    if (source.startsWith("<?", markupStart)) {
      const instructionEnd = source.indexOf("?>", markupStart + 2);
      if (instructionEnd < 0) break;
      cursor = instructionEnd + 2;
      continue;
    }
    if (!source.startsWith("<!DOCTYPE", markupStart)) {
      cursor = markupStart + 1;
      continue;
    }

    let quote: '"' | "'" | null = null;
    let subsetDepth = 0;
    let declarationEnd = -1;
    for (let index = markupStart + 9; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "[") {
        subsetDepth += 1;
      } else if (character === "]" && subsetDepth > 0) {
        subsetDepth -= 1;
      } else if (character === ">" && subsetDepth === 0) {
        declarationEnd = index + 1;
        break;
      }
    }
    if (declarationEnd < 0) reject("Fajl nije ispravan SVG dokument.");
    ranges.push({ start: markupStart, end: declarationEnd });
    cursor = declarationEnd;
  }

  if (ranges.length !== expectedCount) {
    reject("Fajl nije ispravan SVG dokument.");
  }
  let sanitized = "";
  let sourceOffset = 0;
  for (const range of ranges) {
    sanitized += source.slice(sourceOffset, range.start);
    sourceOffset = range.end;
  }
  return sanitized + source.slice(sourceOffset);
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
  if (!hasRasterSignature(mime as EmbeddableRasterMime, decoded)) {
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
      if (
        (elementName === "image" || elementName === "feimage") &&
        value.toLowerCase().startsWith("data:")
      ) {
        validateEmbeddedRaster(value);
        continue;
      }
      if (elementName === "image" || elementName === "feimage") {
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
 * harmless document type declarations are removed, while scripts, event
 * handlers, embedded HTML, entity references and external resources are
 * rejected.
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
  let doctypeCount = 0;
  const parser = new SaxesParser({ xmlns: true });

  parser.on("doctype", () => {
    doctypeCount += 1;
  });
  parser.on("processinginstruction", ({ target }) => {
    if (target.toLowerCase() === "xml-stylesheet") {
      reject("SVG ne sme da sadrži spoljne deklaracije.");
    }
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
  if (doctypeCount === 0) return normalized;

  const sanitized = stripDoctypeDeclarations(normalized, doctypeCount).trim();
  // Validate the exact markup that callers will persist. Besides guarding the
  // declaration scanner, this guarantees that no DTD-only entity survives.
  return validateSafeSvgBytes(new TextEncoder().encode(sanitized));
}
