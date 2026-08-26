import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  type PDFStream,
} from "pdf-lib";

const SENDER_HEADER = "posiljalac";
const REDACTED_CONTACT_NAMES = ["marko taskovic"] as const;
const REDACTED_CONTACT_PHONES = ["381621112222"] as const;
const SAME_COLUMN_TOLERANCE = 3;
const MAX_SENDER_BLOCK_HEIGHT = 100;

type TextBlock = {
  start: number;
  end: number;
  x: number;
  y: number;
  text: string;
};

/**
 * Removes the obsolete personal contact row from official MyGLS PDFs.
 *
 * The provider PDF can contain the same person's name as a recipient, so the
 * redaction is deliberately limited to text in the same column immediately
 * below a "Posiljalac" heading. Replacing the source text operator removes the
 * value from the PDF content stream instead of merely painting over it.
 */
export async function redactMyGlsSenderContactPdf(
  source: Uint8Array | ArrayBuffer,
) {
  const original = Buffer.from(
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
  );
  const document = await PDFDocument.load(original, { updateMetadata: false });
  let redactedCount = 0;

  for (const page of document.getPages()) {
    const contents = page.node.Contents();
    if (!contents) continue;

    const streams = contentStreams(document, contents);
    const replacements = streams.map((stream) => {
      const decoded = decodePDFRawStream(stream).decode();
      const text = Buffer.from(decoded).toString("latin1");
      const fontMaps = readFontMaps(page.node.Resources());
      const blocks = readTextBlocks(text, fontMaps);
      const senderHeaders = blocks.filter((block) =>
        foldText(block.text).includes(SENDER_HEADER),
      );
      const targets = blocks.filter(
        (block) =>
          isRedactedContact(block.text) &&
          senderHeaders.some(
            (header) =>
              Math.abs(header.x - block.x) <= SAME_COLUMN_TOLERANCE &&
              header.y > block.y &&
              header.y - block.y <= MAX_SENDER_BLOCK_HEIGHT,
          ),
      );
      if (!targets.length) return stream;

      let sanitized = text;
      for (const target of targets.sort((left, right) => right.start - left.start)) {
        sanitized = `${sanitized.slice(0, target.start)}()${sanitized.slice(target.end)}`;
      }
      redactedCount += targets.length;
      return document.context.flateStream(Buffer.from(sanitized, "latin1"));
    });

    if (replacements.every((stream, index) => stream === streams[index])) continue;
    const refs = replacements.map((stream) => document.context.register(stream));
    page.node.set(
      PDFName.of("Contents"),
      refs.length === 1 ? refs[0]! : document.context.obj(refs),
    );
  }

  if (!redactedCount) return { bytes: original, redactedCount };
  return {
    bytes: Buffer.from(await document.save({ useObjectStreams: false })),
    redactedCount,
  };
}

function contentStreams(
  document: PDFDocument,
  contents: PDFArray | PDFStream,
) {
  const values = contents instanceof PDFArray
    ? Array.from({ length: contents.size() }, (_, index) => contents.get(index))
    : [contents];
  return values.map((value) => {
    const stream = document.context.lookup(value);
    if (!(stream instanceof PDFRawStream)) {
      throw new Error("MyGLS PDF sadrži nepodržan content stream.");
    }
    return stream;
  });
}

function readFontMaps(
  resources: PDFDict | undefined,
) {
  const maps = new Map<string, Map<number, string>>();
  const fonts = resources?.lookupMaybe(PDFName.of("Font"), PDFDict);
  if (!fonts) return maps;

  for (const key of fonts.keys()) {
    const font = fonts.lookupMaybe(key, PDFDict);
    const toUnicode = font?.lookup(PDFName.of("ToUnicode"));
    if (!(toUnicode instanceof PDFRawStream)) continue;
    const cmap = Buffer.from(decodePDFRawStream(toUnicode).decode()).toString(
      "latin1",
    );
    maps.set(key.decodeText(), parseToUnicodeMap(cmap));
  }
  return maps;
}

function parseToUnicodeMap(cmap: string) {
  const mapping = new Map<number, string>();
  for (const match of cmap.matchAll(
    /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
  )) {
    const start = Number.parseInt(match[1]!, 16);
    const end = Number.parseInt(match[2]!, 16);
    const unicodeStart = Number.parseInt(match[3]!, 16);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start > 512) {
      continue;
    }
    for (let code = start; code <= end; code += 1) {
      mapping.set(code, String.fromCodePoint(unicodeStart + code - start));
    }
  }
  for (const match of cmap.matchAll(
    /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?=endbfchar)/g,
  )) {
    mapping.set(
      Number.parseInt(match[1]!, 16),
      String.fromCodePoint(Number.parseInt(match[2]!, 16)),
    );
  }
  return mapping;
}

function readTextBlocks(
  content: string,
  fontMaps: ReadonlyMap<string, ReadonlyMap<number, string>>,
) {
  const blocks: TextBlock[] = [];
  for (const match of content.matchAll(/\bBT\b[\s\S]*?\bET\b/g)) {
    const body = match[0];
    const position = readTextPosition(body);
    const operand = [...body.matchAll(/(\((?:\\[\s\S]|[^\\)])*\)|<([0-9A-Fa-f\s]+)>)\s*Tj\b/g)].at(-1);
    if (!position || !operand || match.index == null || operand.index == null) continue;
    const fontName = [...body.matchAll(/\/([^\s/]+)\s+[-+]?\d*\.?\d+\s+Tf\b/g)].at(-1)?.[1];
    const bytes = operand[2]
      ? Buffer.from(operand[2].replace(/\s/g, ""), "hex")
      : decodePdfLiteral(operand[1]!.slice(1, -1));
    const decoded = decodeText(bytes, fontName ? fontMaps.get(fontName) : undefined);
    blocks.push({
      start: match.index + operand.index,
      end: match.index + operand.index + operand[1]!.length,
      x: position.x,
      y: position.y,
      text: decoded,
    });
  }
  return blocks;
}

function readTextPosition(body: string) {
  const td = [...body.matchAll(/([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+Td\b/g)].at(-1);
  if (td) return { x: Number(td[1]), y: Number(td[2]) };
  const tm = [...body.matchAll(
    /[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+Tm\b/g,
  )].at(-1);
  return tm ? { x: Number(tm[1]), y: Number(tm[2]) } : null;
}

function decodeText(bytes: Buffer, mapping?: ReadonlyMap<number, string>) {
  if (!mapping?.size) return bytes.toString("latin1");
  let result = "";
  for (let index = 0; index < bytes.length; index += 2) {
    const code = (bytes[index]! << 8) | (bytes[index + 1] ?? 0);
    result += mapping.get(code) ?? "";
  }
  return result;
}

function decodePdfLiteral(value: string) {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code !== 0x5c) {
      bytes.push(code & 0xff);
      continue;
    }
    const next = value[++index];
    if (next == null) break;
    const escaped: Record<string, number> = {
      n: 0x0a,
      r: 0x0d,
      t: 0x09,
      b: 0x08,
      f: 0x0c,
      "(": 0x28,
      ")": 0x29,
      "\\": 0x5c,
    };
    if (escaped[next] != null) {
      bytes.push(escaped[next]);
      continue;
    }
    if (/[0-7]/.test(next)) {
      let octal = next;
      while (octal.length < 3 && /[0-7]/.test(value[index + 1] ?? "")) {
        octal += value[++index];
      }
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    if (next !== "\n" && next !== "\r") bytes.push(next.charCodeAt(0) & 0xff);
  }
  return Buffer.from(bytes);
}

function isRedactedContact(value: string) {
  const text = foldText(value);
  const digits = value.replace(/\D/g, "");
  return (
    REDACTED_CONTACT_NAMES.some((name) => text.includes(name)) ||
    REDACTED_CONTACT_PHONES.some((phone) => digits.includes(phone))
  );
}

function foldText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
