import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SaxesParser, type SaxesTagNS } from "saxes";
import {
  hasRasterSignature,
  type EmbeddableRasterMime,
} from "./raster-signature";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ADOBE_ILLUSTRATOR_NAMESPACE =
  "http://ns.adobe.com/AdobeIllustrator/10.0/";
const ADOBE_ENTITY_VALUES: Record<string, string> = {
  ns_extend: "http://ns.adobe.com/Extensibility/1.0/",
  ns_ai: ADOBE_ILLUSTRATOR_NAMESPACE,
  ns_graphs: "http://ns.adobe.com/Graphs/1.0/",
  ns_vars: "http://ns.adobe.com/Variables/1.0/",
  ns_imrep: "http://ns.adobe.com/ImageReplacement/1.0/",
  ns_sfw: "http://ns.adobe.com/SaveForWeb/1.0/",
  ns_custom: "http://ns.adobe.com/GenericCustomNamespace/1.0/",
  ns_adobe_xpath: "http://ns.adobe.com/XPath/1.0/",
};
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

function stripDoctypeDeclarations(source: string) {
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

  if (ranges.length === 0) return source;
  let sanitized = "";
  let sourceOffset = 0;
  for (const range of ranges) {
    sanitized += source.slice(sourceOffset, range.start);
    sourceOffset = range.end;
  }
  return sanitized + source.slice(sourceOffset);
}

function parseSvgDocument(source: string) {
  const parseErrors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (message) => parseErrors.push(String(message)),
      fatalError: (message) => parseErrors.push(String(message)),
    },
  }).parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (
    parseErrors.length > 0 ||
    !root ||
    root.localName.toLowerCase() !== "svg" ||
    root.namespaceURI !== SVG_NAMESPACE
  ) {
    reject("Fajl nije ispravan SVG dokument.");
  }
  return document;
}

/**
 * Older Illustrator exports include a DTD solely to alias Adobe namespace
 * URLs, plus a non-rendered PGF fallback. Resolve only those fixed aliases and
 * discard the PGF payload before the general safety validator sees the file.
 * Unknown entities and ordinary foreignObject content are left to be rejected.
 */
export function normalizeSvgMarkupForUpload(source: string) {
  let normalized = stripDoctypeDeclarations(
    source.replace(/^\uFEFF/, "").trim(),
  ).replace(
    /&(ns_(?:extend|ai|graphs|vars|imrep|sfw|custom|adobe_xpath));/g,
    (reference, name: string) => ADOBE_ENTITY_VALUES[name] ?? reference,
  );

  if (!normalized.includes(ADOBE_ILLUSTRATOR_NAMESPACE)) {
    return normalized;
  }

  const document = parseSvgDocument(normalized);
  let changed = false;
  const foreignObjects = Array.from(
    document.getElementsByTagNameNS(SVG_NAMESPACE, "foreignObject"),
  );
  for (const element of foreignObjects) {
    const requiredExtensions =
      element.getAttribute("requiredExtensions")?.trim().split(/\s+/) ?? [];
    if (!requiredExtensions.includes(ADOBE_ILLUSTRATOR_NAMESPACE)) continue;
    element.parentNode?.removeChild(element);
    changed = true;
  }

  const illustratorPayloads = Array.from(
    document.getElementsByTagNameNS(ADOBE_ILLUSTRATOR_NAMESPACE, "aipgf"),
  );
  for (const element of illustratorPayloads) {
    element.parentNode?.removeChild(element);
    changed = true;
  }
  if (!changed) return normalized;

  try {
    normalized = new XMLSerializer().serializeToString(
      document,
      false,
      undefined,
      { requireWellFormed: true },
    );
  } catch {
    reject("Fajl nije ispravan SVG dokument.");
  }
  return normalized.trim();
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

  const normalized = normalizeSvgMarkupForUpload(source);
  let rootSeen = false;
  let styleDepth = 0;
  let styleText = "";
  const parser = new SaxesParser({ xmlns: true });

  parser.on("doctype", () => reject("Fajl nije ispravan SVG dokument."));
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
  return normalized;
}
