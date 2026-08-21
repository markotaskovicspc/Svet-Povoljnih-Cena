import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { detectRasterMime } from "./raster-signature";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const LINKED_IMAGE_ELEMENTS = ["image", "feImage"] as const;

export const SVG_COMPANION_REQUIRED = "SVG_COMPANION_REQUIRED";

export type SvgImageCompanion = {
  name: string;
  bytes: Uint8Array;
};

export class SvgCompanionRequiredError extends Error {
  readonly code = SVG_COMPANION_REQUIRED;

  constructor(readonly missing: string[]) {
    super(
      missing.length === 1
        ? `SVG koristi prateću sliku „${missing[0]}”. Prevucite ili izaberite i taj fajl.`
        : `SVG koristi prateće slike: ${missing.join(", ")}. Prevucite ili izaberite i te fajlove.`,
    );
  }
}

function normalizeFileName(value: string) {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

export function svgReferenceFileName(value: string) {
  const withoutQuery = value.split(/[?#]/, 1)[0]?.replace(/\\/g, "/") ?? "";
  const rawName = withoutQuery.split("/").filter(Boolean).at(-1) ?? "";
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function findCompanion(reference: string, companions: SvgImageCompanion[]) {
  const wantedName = normalizeFileName(svgReferenceFileName(reference));
  if (!wantedName) return null;
  const matches = companions.filter(
    (companion) => normalizeFileName(companion.name) === wantedName,
  );
  if (matches.length > 1) {
    throw new Error(
      `Dodato je više pratećih fajlova sa nazivom „${svgReferenceFileName(reference)}”.`,
    );
  }
  return matches[0] ?? null;
}

function dataUrlFor(companion: SvgImageCompanion) {
  const mime = detectRasterMime(companion.bytes);
  if (!mime) {
    throw new Error(
      `Prateća slika „${companion.name}” mora biti ispravan PNG, JPG, WebP ili AVIF fajl.`,
    );
  }
  return `data:${mime};base64,${Buffer.from(companion.bytes).toString("base64")}`;
}

function linkedReference(value: string | null) {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.startsWith("#") || normalized.startsWith("data:")) {
    return null;
  }
  return normalized;
}

export function embedSvgLinkedImages(
  input: ArrayBuffer | Uint8Array,
  companions: SvgImageCompanion[],
) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("SVG mora biti ispravan UTF-8 fajl.");
  }

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
    throw new Error("Fajl nije ispravan SVG dokument.");
  }

  const missing = new Set<string>();
  const embedded = new Set<string>();
  for (const localName of LINKED_IMAGE_ELEMENTS) {
    const elements = document.getElementsByTagNameNS(SVG_NAMESPACE, localName);
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements.item(index);
      if (!element) continue;
      for (const attribute of [
        { namespace: null, qualifiedName: "href" },
        { namespace: XLINK_NAMESPACE, qualifiedName: "xlink:href" },
      ]) {
        const current = attribute.namespace
          ? element.getAttributeNS(attribute.namespace, "href")
          : element.getAttribute(attribute.qualifiedName);
        const reference = linkedReference(current);
        if (!reference) continue;
        const companion = findCompanion(reference, companions);
        if (!companion) {
          missing.add(svgReferenceFileName(reference) || "povezana slika");
          continue;
        }
        const dataUrl = dataUrlFor(companion);
        if (attribute.namespace) {
          element.setAttributeNS(
            attribute.namespace,
            attribute.qualifiedName,
            dataUrl,
          );
        } else {
          element.setAttribute(attribute.qualifiedName, dataUrl);
        }
        embedded.add(companion.name);
      }
    }
  }

  if (missing.size > 0) {
    throw new SvgCompanionRequiredError([...missing].sort());
  }

  let serialized: string;
  try {
    serialized = new XMLSerializer().serializeToString(
      document,
      false,
      undefined,
      { requireWellFormed: true },
    );
  } catch {
    throw new Error("Fajl nije ispravan SVG dokument.");
  }
  return {
    bytes: new TextEncoder().encode(serialized),
    embedded: [...embedded],
  };
}
