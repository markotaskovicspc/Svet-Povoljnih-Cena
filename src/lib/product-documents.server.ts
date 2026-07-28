import "server-only";

import * as mammoth from "mammoth";
import { sanitizeRichText } from "@/lib/rich-text";
import { PRODUCT_DOCUMENT_MAX_BYTES } from "@/lib/product-documents";

const SUPPORTED_FILES = {
  pdf: {
    mimeType: "application/pdf",
    matches: (bytes: Uint8Array) => ascii(bytes, 0, 5) === "%PDF-",
  },
  docx: {
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    matches: (bytes: Uint8Array) =>
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      [0x03, 0x05, 0x07].includes(bytes[2] ?? -1) &&
      [0x04, 0x06, 0x08].includes(bytes[3] ?? -1),
  },
  jpg: {
    mimeType: "image/jpeg",
    matches: (bytes: Uint8Array) =>
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  jpeg: {
    mimeType: "image/jpeg",
    matches: (bytes: Uint8Array) =>
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  png: {
    mimeType: "image/png",
    matches: (bytes: Uint8Array) =>
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a,
  },
} as const;

export type ValidatedProductDocument = {
  buffer: Buffer;
  extension: keyof typeof SUPPORTED_FILES;
  mimeType: string;
  sizeBytes: number;
};

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function fileExtension(name: string) {
  return name.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

export async function validateProductDocument(
  file: File,
  options: { docxOnly?: boolean } = {},
): Promise<ValidatedProductDocument> {
  if (file.size <= 0) throw new Error("Izaberite fajl za upload.");
  if (file.size > PRODUCT_DOCUMENT_MAX_BYTES) {
    throw new Error("Fajl ne sme biti veći od 10 MB.");
  }
  const extension = fileExtension(file.name);
  if (options.docxOnly && extension !== "docx") {
    throw new Error("Formatirani opis može da se uveze samo iz DOCX fajla.");
  }
  if (!(extension in SUPPORTED_FILES)) {
    throw new Error("Dozvoljeni formati su PDF, DOCX, JPG i PNG.");
  }
  const supported = SUPPORTED_FILES[extension as keyof typeof SUPPORTED_FILES];
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!supported.matches(buffer)) {
    throw new Error("Sadržaj fajla ne odgovara njegovoj ekstenziji.");
  }
  const declaredMime = file.type.trim().toLowerCase();
  const acceptedDeclaredMime =
    !declaredMime ||
    declaredMime === "application/octet-stream" ||
    declaredMime === supported.mimeType;
  if (!acceptedDeclaredMime) {
    throw new Error("MIME tip fajla ne odgovara njegovoj ekstenziji.");
  }
  if (extension === "docx") {
    try {
      await mammoth.extractRawText({ buffer });
    } catch {
      throw new Error("DOCX paket nije ispravan ili ne sadrži Word dokument.");
    }
  }
  return {
    buffer,
    extension: extension as keyof typeof SUPPORTED_FILES,
    mimeType: supported.mimeType,
    sizeBytes: file.size,
  };
}

export async function convertDocxDescription(buffer: Buffer) {
  let converted;
  try {
    converted = await mammoth.convertToHtml(
      { buffer },
      {
        styleMap: [
          "p[style-name='Title'] => h2:fresh",
          "p[style-name='Heading 1'] => h2:fresh",
          "p[style-name='Heading 2'] => h3:fresh",
        ],
      },
    );
  } catch {
    throw new Error("DOCX fajl nije ispravan ili ne može da se pročita.");
  }
  const unsupported: string[] = [];
  if (/<img\b/i.test(converted.value)) {
    unsupported.push("Slike iz DOCX fajla nisu uvezene.");
  }
  if (/<table\b/i.test(converted.value)) {
    unsupported.push("Tabele su uvezene kao običan tekst.");
  }
  const html = sanitizeRichText(converted.value).trim();
  if (!html) throw new Error("DOCX fajl ne sadrži tekst koji može da se uveze.");
  return {
    html,
    warnings: Array.from(
      new Set([
        ...unsupported,
        ...converted.messages
          .filter((message) => message.type === "warning")
          .map((message) => message.message),
      ]),
    ),
  };
}
